import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc.js";
import { CompletionSummary, type CompletionSummaryData } from "./CompletionSummary.js";
import { ManualCompletionModal } from "./ManualCompletionModal.js";

type WidgetMode = "collapsed" | "expanded";
type Overlay = "completing" | "aborting" | "summary" | null;

const WALL_START_STORAGE_KEY = "flightcareer.wallStart";

function loadStoredWallStart(jobId: number): number | null {
  try {
    const raw = window.localStorage.getItem(WALL_START_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jobId: number; startedAt: number };
    return parsed.jobId === jobId ? parsed.startedAt : null;
  } catch {
    return null;
  }
}

function persistWallStart(jobId: number, startedAt: number): void {
  try {
    window.localStorage.setItem(
      WALL_START_STORAGE_KEY,
      JSON.stringify({ jobId, startedAt }),
    );
  } catch {
    /* ignore */
  }
}

function clearStoredWallStart(): void {
  try {
    window.localStorage.removeItem(WALL_START_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${m.toString().padStart(2, "0")}m ${s
      .toString()
      .padStart(2, "0")}s`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function PlaneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 12 L20 6 L21 8 L7 14 Z" />
      <path d="M9 13 L11 19 L13 18 L12 14" />
      <path d="M5 12 L7 13" />
    </svg>
  );
}

export function InFlightSurface() {
  const utils = trpc.useUtils();
  const active = trpc.lifecycle.getActiveJob.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const [mode, setMode] = useState<WidgetMode>("expanded");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [summary, setSummary] = useState<CompletionSummaryData | null>(null);

  // Wall-clock start, captured the first moment we see in_progress for a
  // given job. Persisted in localStorage by jobId so a refresh mid-flight
  // doesn't reset the elapsed counter.
  const [wallStart, setWallStart] = useState<number | null>(null);
  const trackedJobIdRef = useRef<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const data = active.data;
  const isInFlight = data?.state === "in_progress";

  // Initialize wall start when in_progress for a new job. Reset widget mode
  // to expanded so the next flight surfaces by default.
  useEffect(() => {
    if (isInFlight && data) {
      if (trackedJobIdRef.current !== data.job.id) {
        trackedJobIdRef.current = data.job.id;
        const stored = loadStoredWallStart(data.job.id);
        if (stored != null) {
          setWallStart(stored);
        } else {
          const startedAt = Date.now();
          setWallStart(startedAt);
          persistWallStart(data.job.id, startedAt);
        }
        setMode("expanded");
      }
    } else if (!isInFlight) {
      trackedJobIdRef.current = null;
      setWallStart(null);
      clearStoredWallStart();
    }
  }, [isInFlight, data]);

  // 1 Hz tick for elapsed counter — only while expanded and in flight.
  useEffect(() => {
    if (!isInFlight || mode !== "expanded") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isInFlight, mode]);

  const abortMutation = trpc.lifecycle.abort.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        void utils.lifecycle.getActiveJob.invalidate();
        void utils.career.get.invalidate();
        void utils.jobs.list.invalidate();
        void utils.aircraft.candidatesForJob.invalidate();
        setOverlay(null);
      }
    },
  });

  const completeMutation = trpc.lifecycle.complete.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        setSummary(result.summary);
        setOverlay("summary");
        void utils.lifecycle.getActiveJob.invalidate();
        void utils.career.get.invalidate();
        void utils.jobs.list.invalidate();
        void utils.aircraft.candidatesForJob.invalidate();
        // Owned-aircraft state may change at completion (hours, fuel,
        // unscheduled maintenance grounding) — refresh the hangar surfaces.
        void utils.hangar.fleet.invalidate();
        void utils.hangar.aircraftById.invalidate();
        void utils.maintenance.options.invalidate();
        void utils.logbook.maintenance.invalidate();
        void utils.logbook.flights.invalidate();
      }
    },
  });

  // If overlay is "summary", keep showing it even after lifecycle clears.
  if (!isInFlight && overlay !== "summary") {
    return null;
  }

  // ── Summary takes priority, full-screen ────────────────────────────────
  if (overlay === "summary" && summary) {
    return (
      <CompletionSummary
        summary={summary}
        onClose={() => {
          setOverlay(null);
          setSummary(null);
          setMode("expanded");
        }}
      />
    );
  }

  if (!data || !isInFlight) return null;

  const elapsedMs = wallStart != null ? now - wallStart : 0;
  const j = data.job;
  const a = data.aircraft;

  return (
    <>
      {mode === "collapsed" ? (
        <button
          type="button"
          onClick={() => setMode("expanded")}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-amber-glow bg-ink-800/95 text-amber-glow shadow-[0_0_0_1px_rgba(212,165,116,0.55),0_0_22px_-4px_rgba(212,165,116,0.65)] backdrop-blur hover:bg-ink-750"
          aria-label="Show in-flight widget"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/60" />
            <span className="relative h-2 w-2 rounded-full bg-amber-glow" />
          </span>
          <PlaneIcon className="ml-1.5" />
        </button>
      ) : (
        <div className="fixed bottom-5 right-5 z-40 w-[340px] border border-amber-deep/70 bg-ink-800/95 shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_18px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur">
          {/* Header strip */}
          <div className="flex items-center justify-between border-b border-amber-deep/60 bg-ink-850 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/60" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
              </span>
              <span className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
                In flight · #{String(j.id).padStart(5, "0")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMode("collapsed")}
              aria-label="Minimize"
              className="flex h-6 w-6 items-center justify-center rounded-sm border border-ink-600 text-muted hover:border-amber-deep hover:text-amber-glow"
            >
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                <path d="M2 6 H10" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>

          {/* Route */}
          <div className="border-b border-ink-700 px-4 py-3">
            <div className="flex items-center justify-between font-mono">
              <div className="flex flex-col items-start">
                <span className="label">From</span>
                <span className="icao text-[18px] tracking-callsign text-text-high">
                  {j.originIcao}
                </span>
              </div>
              <div className="flex-1 px-3">
                <svg
                  width="100%"
                  height="10"
                  viewBox="0 0 200 10"
                  preserveAspectRatio="none"
                  className="text-amber-deep"
                  aria-hidden
                >
                  <line
                    x1="2"
                    y1="5"
                    x2="198"
                    y2="5"
                    stroke="currentColor"
                    strokeDasharray="3 4"
                  />
                  <circle cx="2" cy="5" r="2.5" fill="currentColor" />
                  <circle cx="198" cy="5" r="2.5" fill="currentColor" />
                </svg>
                <div className="mt-1 text-center text-[10px] uppercase tracking-callsign text-muted-dim">
                  {Math.round(j.distanceNm)} nm
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="label">To</span>
                <span className="icao text-[18px] tracking-callsign text-text-high">
                  {j.destinationIcao}
                </span>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-4 py-3 font-mono">
            <div className="flex items-center justify-between">
              <span className="label">Aircraft</span>
              <span className="text-tiny text-text">
                {a.manufacturer} {a.model}
                {a.source === "owned" && a.tailNumber ? (
                  <span className="ml-2 text-muted-dim">{a.tailNumber}</span>
                ) : (
                  <span className="ml-2 text-muted-dim">rental</span>
                )}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="label">Elapsed</span>
              <span className="text-[15px] tabular-nums text-amber-warm">
                {formatElapsed(elapsedMs)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-tiny">
              <span className="label">Sim link</span>
              <span className="text-muted">
                MSFS · <span className="text-muted-dim">manual mode</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-stretch border-t border-ink-700">
            <button
              type="button"
              onClick={() => setOverlay("aborting")}
              disabled={abortMutation.isPending}
              className="flex-1 border-r border-ink-700 bg-ink-850 px-3 py-2.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:bg-ink-800 hover:text-urgency-critical disabled:opacity-40"
            >
              Abort flight
            </button>
            <button
              type="button"
              onClick={() => setOverlay("completing")}
              className="flex-[1.4] bg-amber-glow/[0.10] px-3 py-2.5 font-mono text-[11px] uppercase tracking-callsign text-amber-warm hover:bg-amber-glow/[0.18]"
            >
              Complete manually ▸
            </button>
          </div>
        </div>
      )}

      {/* Manual completion modal */}
      {overlay === "completing" && data && (
        <ManualCompletionModal
          job={{
            id: j.id,
            originIcao: j.originIcao,
            destinationIcao: j.destinationIcao,
            destinationName: j.destinationName,
            distanceNm: j.distanceNm,
          }}
          aircraft={{
            cruiseSpeedKts: a.cruiseSpeedKts,
            fuelBurnGph: a.fuelBurnGph,
          }}
          elapsedMs={elapsedMs}
          isPending={completeMutation.isPending}
          errorMessage={
            completeMutation.data && !completeMutation.data.ok
              ? completeMutation.data.error
              : completeMutation.error?.message ?? null
          }
          onClose={() => setOverlay(null)}
          onSubmit={(input) => completeMutation.mutate(input)}
        />
      )}

      {/* Abort confirm */}
      {overlay === "aborting" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm abort"
          onClick={() => setOverlay(null)}
        >
          <div
            className="relative w-[440px] max-w-[92vw] border border-urgency-critical/60 bg-ink-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-urgency-critical/40 bg-urgency-critical/[0.06] px-5 py-3">
              <div className="font-mono text-micro uppercase tracking-callsign text-urgency-critical">
                Confirm abort
              </div>
              <div className="mt-1 font-display text-[18px] text-text-high">
                Abort flight #{String(j.id).padStart(5, "0")}?
              </div>
            </div>
            <div className="px-5 py-4">
              <ul className="list-disc space-y-1.5 pl-5 font-mono text-tiny text-text">
                {j.role === "open" ? (
                  <li>Reputation: no change (open-market job)</li>
                ) : (
                  <li>
                    Reputation:{" "}
                    <span className="text-urgency-critical">
                      {data.cancelPenalty.role}
                    </span>{" "}
                    in role
                    {j.clientId && (
                      <>
                        ,{" "}
                        <span className="text-urgency-critical">
                          {data.cancelPenalty.client}
                        </span>{" "}
                        with this client
                      </>
                    )}
                  </li>
                )}
                <li>Pay forfeited; briefed fuel non-refundable</li>
                <li>Aircraft returns to available (no hours added)</li>
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-ink-700 bg-ink-850 px-5 py-3">
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
              >
                Keep flying
              </button>
              <button
                type="button"
                disabled={abortMutation.isPending}
                onClick={() => abortMutation.mutate()}
                className="rounded-sm border border-urgency-critical/70 bg-urgency-critical/[0.12] px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-urgency-critical hover:bg-urgency-critical/[0.22] disabled:opacity-40"
              >
                {abortMutation.isPending ? "Aborting…" : "Confirm abort"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
