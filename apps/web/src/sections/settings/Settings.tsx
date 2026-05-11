import { trpc } from "../../trpc.js";

function StatusDot({ tone }: { tone: "ok" | "warn" | "off" | "pending" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
      : tone === "warn"
        ? "bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.55)]"
        : tone === "pending"
          ? "bg-amber-warm/70"
          : "bg-muted-dim";
  return <span className={["h-2 w-2 rounded-full", cls].join(" ")} />;
}

function fmtCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function Settings() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.simBridge.status.useQuery(undefined, {
    refetchInterval: 1_000,
  });
  const stateQuery = trpc.simBridge.currentState.useQuery(undefined, {
    refetchInterval: 1_000,
    enabled: statusQuery.data?.enabled ?? false,
  });
  const toggle = trpc.simBridge.toggleEnabled.useMutation({
    onSuccess: () => {
      void utils.simBridge.status.invalidate();
      void utils.simBridge.currentState.invalidate();
    },
  });
  const test = trpc.simBridge.testConnection.useMutation({
    onSuccess: () => {
      void utils.simBridge.status.invalidate();
    },
  });

  const status = statusQuery.data;
  const enabled = status?.enabled ?? false;
  const state = stateQuery.data ?? null;

  let bridgeLabel = "Bridge offline";
  let bridgeTone: "ok" | "warn" | "off" | "pending" = "off";
  let detailLine: string | null = null;
  if (enabled && status) {
    if (status.bridgeConnection === "connected" && status.simConnection === "connected") {
      bridgeLabel = "Bridge connected · MSFS detected";
      bridgeTone = "ok";
      detailLine = status.simVersion ?? null;
    } else if (status.bridgeConnection === "connected") {
      bridgeLabel = "Bridge connected · MSFS not detected";
      bridgeTone = "warn";
      detailLine = "Start MSFS to enable tracked flights.";
    } else if (status.bridgeConnection === "connecting") {
      bridgeLabel = "Connecting to bridge…";
      bridgeTone = "pending";
    } else {
      bridgeLabel = "Bridge offline";
      bridgeTone = "off";
      detailLine =
        "Start the SimBridge process and confirm it's running on localhost:8765.";
    }
  } else if (enabled && !status) {
    bridgeLabel = "Loading…";
    bridgeTone = "pending";
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="border-b border-ink-600 bg-ink-850 px-6 py-4">
        <div className="font-mono text-micro uppercase tracking-callsign text-muted-dim">
          Console · Settings
        </div>
        <div className="mt-1 font-display text-xl font-semibold text-text-high">
          Settings
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
        <div className="max-w-[720px] space-y-6">
          <section className="rounded-sm border border-ink-600 bg-ink-800 p-5">
            <div className="flex items-center gap-2">
              <span className="label">MSFS Integration</span>
              <span className="h-px flex-1 bg-ink-600" />
            </div>

            <div className="mt-4 flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <div className="font-display text-[15px] text-text-high">
                  Enable Microsoft Flight Simulator integration
                </div>
                <div className="mt-1 max-w-[480px] font-mono text-tiny leading-relaxed text-muted">
                  When enabled, you can fly your jobs in MSFS and the app will
                  automatically detect takeoff, landing, and block time. Manual
                  completion remains available at any point.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ enabled: !enabled })}
                className={[
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
                  enabled
                    ? "border-amber-deep bg-amber-glow/[0.40]"
                    : "border-ink-500 bg-ink-700",
                  toggle.isPending ? "opacity-60" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-4 w-4 transform rounded-full bg-text-high transition-transform",
                    enabled ? "translate-x-6" : "translate-x-1",
                  ].join(" ")}
                />
              </button>
            </div>

            {enabled ? (
              <div className="mt-5 rounded-sm border border-ink-700 bg-ink-850 p-4">
                <div className="flex items-center gap-2">
                  <StatusDot tone={bridgeTone} />
                  <span className="font-mono text-tiny text-text">
                    {bridgeLabel}
                  </span>
                </div>
                {detailLine && (
                  <div className="mt-1 font-mono text-micro text-muted-dim">
                    {detailLine}
                  </div>
                )}

                {state && status?.simConnection === "connected" && (
                  <div className="mt-3 grid grid-cols-1 gap-1 font-mono text-tiny text-muted">
                    <div className="flex justify-between">
                      <span>Aircraft</span>
                      <span className="text-text">{state.title || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Position</span>
                      <span className="text-text tabular-nums">
                        {fmtCoord(state.positionLat, state.positionLon)}
                        {state.onGround ? " (on ground)" : ""}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Altitude</span>
                      <span className="text-text tabular-nums">
                        {Math.round(state.altitudeFt).toLocaleString()} ft
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ground speed</span>
                      <span className="text-text tabular-nums">
                        {Math.round(state.groundSpeedKts)} kts
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fuel</span>
                      <span className="text-text tabular-nums">
                        {state.fuelTotalGal.toFixed(1)} gal
                      </span>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                    className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow disabled:opacity-50"
                  >
                    {test.isPending ? "Testing…" : "Test connection"}
                  </button>
                  {bridgeTone === "off" && (
                    <span className="font-mono text-micro text-muted-dim">
                      See <span className="text-text">apps/sim-bridge/README.md</span> for setup.
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-5 font-mono text-tiny text-muted-dim">
                MSFS integration disabled.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
