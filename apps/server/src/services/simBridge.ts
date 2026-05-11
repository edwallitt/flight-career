import { eq } from "drizzle-orm";
import { WebSocket } from "ws";
import { db } from "../db/client.js";
import { career, trackingState } from "../db/schema.js";
import { getMsfsEnabled } from "./settings.js";

// =============================================================================
// SimBridge service
// -----------------------------------------------------------------------------
// Long-lived websocket client for the .NET SimBridge process. The bridge runs
// out-of-process on the local machine; this service connects, holds the
// connection, persists tracked-flight state to the DB, and exposes a small API
// to the rest of the server (lifecycle + tRPC routers).
//
// Key constraints:
//   * Server boot must never block or crash if the bridge is unreachable.
//     Connection failures are silent except for status indicators.
//   * The bridge protocol uses wall-clock unix ms in every timestamp. We never
//     translate to sim time — those two clocks intentionally stay separate.
//   * State is fed via polling from the UI, not tRPC subscriptions (Hono+tRPC
//     v11 here is HTTP-only). The UI hits status() at 1-2Hz on relevant
//     screens.
// =============================================================================

const BRIDGE_URL = process.env.SIMBRIDGE_URL ?? "ws://127.0.0.1:8765";
const RECONNECT_DELAY_MS = 5_000;

export type BridgeConnectionState = "connected" | "disconnected" | "connecting";
export type SimConnectionState =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unknown";

export interface SimBridgeStatus {
  enabled: boolean;
  bridgeConnection: BridgeConnectionState;
  simConnection: SimConnectionState;
  simVersion: string | null;
  lastUpdate: number | null;
  isTracking: boolean;
  trackedJobId: number | null;
  lastEvent: TrackedFlightEventRecord | null;
}

export interface AircraftStateSnapshot {
  positionLat: number;
  positionLon: number;
  altitudeFt: number;
  groundSpeedKts: number;
  trueHeadingDeg: number;
  onGround: boolean;
  engineRunning: boolean;
  fuelTotalGal: number;
  simulationRate: number;
  title: string;
  timestamp: number;
}

export type TrackedFlightEventName =
  | "engine_started"
  | "engine_stopped"
  | "lifted_off"
  | "touched_down";

export interface TrackedFlightEventRecord {
  event: TrackedFlightEventName;
  timestamp: number;
  positionLat?: number;
  positionLon?: number;
}

export interface BeginTrackingResult {
  ok: boolean;
  error?: string;
}

class SimBridgeService {
  private ws: WebSocket | null = null;
  private bridgeConnection: BridgeConnectionState = "disconnected";
  private simConnection: SimConnectionState = "unknown";
  private simVersion: string | null = null;
  private currentState: AircraftStateSnapshot | null = null;
  private lastUpdate: number | null = null;
  private currentTrackedJobId: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private started = false;

  /**
   * Boot the service. Idempotent. Pulls the enabled flag from settings and
   * also recovers an in-progress tracked flight from the career row so a
   * server restart mid-flight resumes cleanly.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // If the server crashed mid-tracked-flight, pick up where we left off.
    // Wrapped because the columns referenced here are recent — a server boot
    // against an un-migrated DB would otherwise throw and surface a confusing
    // stack trace. Recovery is a nice-to-have; a missed pickup just means the
    // player completes the flight manually.
    try {
      const careerRow = db
        .select({
          activeJobId: career.activeJobId,
          activeFlightState: career.activeFlightState,
          trackingMode: career.trackingMode,
        })
        .from(career)
        .where(eq(career.id, 1))
        .get();
      if (
        careerRow?.activeFlightState === "in_progress" &&
        careerRow.trackingMode === "tracked" &&
        careerRow.activeJobId != null
      ) {
        this.currentTrackedJobId = careerRow.activeJobId;
      }
    } catch (err) {
      console.warn(
        "[simBridge] startup recovery skipped (run pnpm db:migrate if this persists):",
        (err as Error).message,
      );
    }

    if (!getMsfsEnabled()) return;
    this.connect();
  }

  /**
   * Demote the currently tracked flight to manual mode in memory. The DB-level
   * `career.trackingMode` rollback is the caller's responsibility — this
   * service only owns the in-memory pointer and the tracking_state row.
   */
  switchToManual(): number | null {
    const jobId = this.currentTrackedJobId;
    if (jobId == null) return null;
    this.currentTrackedJobId = null;
    try {
      // Preserve the tracking_state row so any sim_* fields captured up to
      // this point can still be persisted by a subsequent completion. The row
      // is GC'd by the complete/abort path.
      db.update(trackingState)
        .set({ bridgeStatus: "disconnected", lastUpdatedAt: Date.now() })
        .where(eq(trackingState.jobId, jobId))
        .run();
    } catch {
      // best-effort; row may have already been cleared
    }
    return jobId;
  }

  /**
   * Tear down the connection. Used when the player toggles MSFS integration
   * off at runtime. Demotes any in-progress tracked flight to manual mode
   * — the alternative would leave the in-flight surface rendering a tracked
   * panel against a dead bridge with no way out short of aborting.
   */
  stop(): void {
    this.started = false;
    this.clearReconnectTimer();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.bridgeConnection = "disconnected";
    this.simConnection = "unknown";
    this.simVersion = null;
    this.currentState = null;
    this.lastUpdate = null;

    if (this.currentTrackedJobId != null) {
      this.switchToManual();
      try {
        db.update(career)
          .set({ trackingMode: "manual" })
          .where(eq(career.id, 1))
          .run();
      } catch (err) {
        console.warn("[simBridge] failed to flip career.trackingMode on stop:", err);
      }
    }
  }

  /**
   * Toggle the integration. The settings table has already been updated by
   * the caller; this just brings the connection up or down.
   */
  applyEnabledChange(enabled: boolean): void {
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /**
   * Force a reconnect attempt. Used by the diagnostic Test Connection button.
   */
  forceReconnect(): void {
    if (!getMsfsEnabled()) return;
    this.clearReconnectTimer();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connect();
  }

  getStatus(): SimBridgeStatus {
    let lastEvent: TrackedFlightEventRecord | null = null;
    if (this.currentTrackedJobId != null) {
      const row = db
        .select({ eventsReceived: trackingState.eventsReceived })
        .from(trackingState)
        .where(eq(trackingState.jobId, this.currentTrackedJobId))
        .get();
      if (row) {
        try {
          const events = JSON.parse(row.eventsReceived) as TrackedFlightEventRecord[];
          lastEvent = events[events.length - 1] ?? null;
        } catch {
          // ignore corrupt JSON
        }
      }
    }
    return {
      enabled: getMsfsEnabled(),
      bridgeConnection: this.bridgeConnection,
      simConnection: this.simConnection,
      simVersion: this.simVersion,
      lastUpdate: this.lastUpdate,
      isTracking: this.currentTrackedJobId != null,
      trackedJobId: this.currentTrackedJobId,
      lastEvent,
    };
  }

  getCurrentState(): AircraftStateSnapshot | null {
    return this.currentState;
  }

  isReadyForTracking(): boolean {
    return (
      getMsfsEnabled() &&
      this.bridgeConnection === "connected" &&
      this.simConnection === "connected"
    );
  }

  /**
   * Begin tracking a flight. Initializes the tracking_state row with current
   * snapshot data so the UI has something to render before the first event
   * fires. Caller is responsible for verifying job lifecycle preconditions
   * and updating career.trackingMode.
   */
  beginTracking(jobId: number): BeginTrackingResult {
    if (!getMsfsEnabled()) {
      return { ok: false, error: "MSFS integration is disabled" };
    }
    if (this.bridgeConnection !== "connected") {
      return { ok: false, error: "SimBridge is not connected" };
    }
    if (this.simConnection !== "connected") {
      return { ok: false, error: "MSFS is not running" };
    }

    this.currentTrackedJobId = jobId;

    const snap = this.currentState;
    const now = Date.now();
    db.insert(trackingState)
      .values({
        jobId,
        currentPositionLat: snap?.positionLat ?? null,
        currentPositionLon: snap?.positionLon ?? null,
        currentAltitudeFt: snap?.altitudeFt ?? null,
        currentGroundSpeedKts: snap?.groundSpeedKts ?? null,
        currentTrueHeadingDeg: snap?.trueHeadingDeg ?? null,
        onGround: snap?.onGround ?? null,
        engineRunning: snap?.engineRunning ?? null,
        fuelTotalGal: snap?.fuelTotalGal ?? null,
        eventsReceived: "[]",
        fuelAtEngineStartGal: null,
        lastUpdatedAt: now,
        bridgeStatus: "connected",
      })
      .onConflictDoUpdate({
        target: trackingState.jobId,
        set: {
          currentPositionLat: snap?.positionLat ?? null,
          currentPositionLon: snap?.positionLon ?? null,
          currentAltitudeFt: snap?.altitudeFt ?? null,
          currentGroundSpeedKts: snap?.groundSpeedKts ?? null,
          currentTrueHeadingDeg: snap?.trueHeadingDeg ?? null,
          onGround: snap?.onGround ?? null,
          engineRunning: snap?.engineRunning ?? null,
          fuelTotalGal: snap?.fuelTotalGal ?? null,
          eventsReceived: "[]",
          fuelAtEngineStartGal: null,
          lastUpdatedAt: now,
          bridgeStatus: "connected",
        },
      })
      .run();

    return { ok: true };
  }

  /**
   * Stop tracking. Caller decides whether to clear the row (after persisting
   * the data into a flight) or leave it for diagnostics.
   */
  endTracking(jobId: number, deleteRow = true): void {
    if (this.currentTrackedJobId === jobId) {
      this.currentTrackedJobId = null;
    }
    if (deleteRow) {
      try {
        db.delete(trackingState).where(eq(trackingState.jobId, jobId)).run();
      } catch (err) {
        console.warn(`[simBridge] failed to clear tracking_state for job ${jobId}:`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: connection + message handling
  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.ws) return;
    this.bridgeConnection = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch (err) {
      console.warn("[simBridge] connect threw:", err);
      this.bridgeConnection = "disconnected";
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.bridgeConnection = "connected";
      // Subscribe immediately. The bridge is cheap; staying subscribed keeps
      // the header chip live even outside of tracked flights.
      try {
        ws.send(JSON.stringify({ type: "subscribe" }));
      } catch (err) {
        console.warn("[simBridge] subscribe failed:", err);
      }
    });

    ws.on("message", (data) => {
      let text: string;
      try {
        text = typeof data === "string" ? data : data.toString("utf8");
      } catch {
        return;
      }
      this.handleMessage(text);
    });

    ws.on("error", (err) => {
      // The 'close' handler will fire next and trigger a reconnect — just log.
      console.warn("[simBridge] websocket error:", (err as Error).message);
    });

    ws.on("close", () => {
      this.ws = null;
      this.bridgeConnection = "disconnected";
      this.simConnection = "unknown";
      this.simVersion = null;
      // Drop the cached aircraft snapshot. Without this, the UI would render
      // the last known position indefinitely after a disconnect, which is
      // misleading next to the "MSFS connection lost" banner.
      this.currentState = null;
      this.lastUpdate = null;
      // Persist the disconnect into tracking_state if a flight is in progress.
      if (this.currentTrackedJobId != null) {
        try {
          db.update(trackingState)
            .set({ bridgeStatus: "reconnecting", lastUpdatedAt: Date.now() })
            .where(eq(trackingState.jobId, this.currentTrackedJobId))
            .run();
        } catch {
          // ignore
        }
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.started || !getMsfsEnabled()) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const msg = parsed as Record<string, unknown>;
    const type = msg.type;
    switch (type) {
      case "connection.status":
        this.handleConnectionStatus(msg);
        break;
      case "aircraft.state":
        this.handleAircraftState(msg);
        break;
      case "flight.event":
        this.handleFlightEvent(msg);
        break;
      default:
        // ignore pong / unknown
        break;
    }
  }

  private handleConnectionStatus(msg: Record<string, unknown>): void {
    const status = msg.status;
    if (
      status === "connected" ||
      status === "disconnected" ||
      status === "reconnecting"
    ) {
      this.simConnection = status;
    } else if (status === "connecting") {
      this.simConnection = "reconnecting";
    } else {
      this.simConnection = "unknown";
    }
    this.simVersion = typeof msg.simVersion === "string" ? msg.simVersion : null;
  }

  private handleAircraftState(msg: Record<string, unknown>): void {
    const pos = msg.position as Record<string, unknown> | undefined;
    if (!pos) return;
    const snap: AircraftStateSnapshot = {
      positionLat: numberOr(pos.lat, 0),
      positionLon: numberOr(pos.lon, 0),
      altitudeFt: numberOr(pos.altitudeFt, 0),
      groundSpeedKts: numberOr(pos.groundSpeedKts, 0),
      trueHeadingDeg: numberOr(pos.trueHeadingDeg, 0),
      onGround: msg.onGround === true,
      engineRunning: msg.engineRunning === true,
      fuelTotalGal: numberOr(msg.fuelTotalGal, 0),
      simulationRate: numberOr(msg.simulationRate, 1),
      title: typeof msg.title === "string" ? msg.title : "",
      timestamp: numberOr(msg.timestamp, Date.now()),
    };
    this.currentState = snap;
    this.lastUpdate = snap.timestamp;
    this.persistState(snap);
  }

  private persistState(snap: AircraftStateSnapshot): void {
    if (this.currentTrackedJobId == null) return;
    try {
      db.update(trackingState)
        .set({
          currentPositionLat: snap.positionLat,
          currentPositionLon: snap.positionLon,
          currentAltitudeFt: snap.altitudeFt,
          currentGroundSpeedKts: snap.groundSpeedKts,
          currentTrueHeadingDeg: snap.trueHeadingDeg,
          onGround: snap.onGround,
          engineRunning: snap.engineRunning,
          fuelTotalGal: snap.fuelTotalGal,
          lastUpdatedAt: Date.now(),
          bridgeStatus: "connected",
        })
        .where(eq(trackingState.jobId, this.currentTrackedJobId))
        .run();
    } catch (err) {
      console.warn("[simBridge] persist state failed:", err);
    }
  }

  private handleFlightEvent(msg: Record<string, unknown>): void {
    const event = msg.event;
    if (
      event !== "engine_started" &&
      event !== "engine_stopped" &&
      event !== "lifted_off" &&
      event !== "touched_down"
    ) {
      return;
    }
    const ts = numberOr(msg.timestamp, Date.now());
    if (this.currentTrackedJobId == null) return;
    const record: TrackedFlightEventRecord = {
      event,
      timestamp: ts,
    };
    if (this.currentState) {
      record.positionLat = this.currentState.positionLat;
      record.positionLon = this.currentState.positionLon;
    }
    try {
      const row = db
        .select({ eventsReceived: trackingState.eventsReceived, fuelAtEngineStartGal: trackingState.fuelAtEngineStartGal })
        .from(trackingState)
        .where(eq(trackingState.jobId, this.currentTrackedJobId))
        .get();
      if (!row) return;
      let events: TrackedFlightEventRecord[] = [];
      try {
        events = JSON.parse(row.eventsReceived) as TrackedFlightEventRecord[];
      } catch {
        events = [];
      }
      events.push(record);

      const update: Partial<typeof trackingState.$inferInsert> = {
        eventsReceived: JSON.stringify(events),
        lastUpdatedAt: Date.now(),
      };
      // Capture fuel at engine start the first time it fires — used for the
      // sim-derived fuel-burn delta at completion.
      if (
        event === "engine_started" &&
        row.fuelAtEngineStartGal == null &&
        this.currentState
      ) {
        update.fuelAtEngineStartGal = this.currentState.fuelTotalGal;
      }
      // Capture fuel at engine stop too — so a player who refuels at the
      // gate before logging the flight doesn't ruin the burn calculation.
      // We use the latest engine_stopped snapshot, not the first, because
      // a player may shut down, restart, and shut down again (taxi-back).
      if (event === "engine_stopped" && this.currentState) {
        update.fuelAtEngineStopGal = this.currentState.fuelTotalGal;
      }
      db.update(trackingState)
        .set(update)
        .where(eq(trackingState.jobId, this.currentTrackedJobId))
        .run();
    } catch (err) {
      console.warn("[simBridge] flight event persist failed:", err);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const simBridge = new SimBridgeService();
