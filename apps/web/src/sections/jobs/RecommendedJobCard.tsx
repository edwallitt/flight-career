import {
  formatPay,
  formatRelativeFromNow,
  ROLE_LABEL,
} from "../../lib/formatters.js";
import type { JobRow } from "./types.js";

// The "what should I fly next?" answer, rendered with enough weight that the
// player's eye lands on it before the table. Server picks the row via
// `recommendedJobId` (highest pay/hr at the player's current location, fit
// status ready); we just dress it up here and route a click into the drawer.
//
// Renders nothing when there is no recommendation — typically a freshly
// reset career or a board where everything is locked / repositioning /
// expiring. That's an OK silent state: the FleetStrip + filters still
// guide the player toward the right action.

export function RecommendedJobCard({
  job,
  simNow,
  onOpen,
  playerLocationIcao,
  captionMode = "from-here",
}: {
  job: JobRow | null;
  simNow: number;
  onOpen: (job: JobRow) => void;
  // The airport the recommendation is anchored to. When `captionMode` is
  // "from-here" this is the player's current location. When "after-arrival"
  // it's the destination of the in-flight contract — the rec answers
  // "what should I take when I land?" rather than "what can I take now?"
  playerLocationIcao: string;
  captionMode?: "from-here" | "after-arrival";
}) {
  if (!job) return null;
  const expiresIn = formatRelativeFromNow(job.expiresAt, simNow);
  const isOpen = job.role === "open";
  const isFerry = job.jobType === "ferry";
  const roleLabel = isFerry
    ? "Ferry"
    : isOpen
    ? "Open Market"
    : ROLE_LABEL[job.role] ?? job.role;

  return (
    <section
      aria-label="Recommended next flight"
      className="border-b border-amber-deep/40 bg-gradient-to-r from-amber-glow/[0.07] via-amber-glow/[0.04] to-transparent px-6 py-3"
    >
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-5">
          {/* Label */}
          <div className="flex shrink-0 flex-col gap-1">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Recommended next
            </span>
            <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
              {captionMode === "after-arrival"
                ? `best $/hr from ${playerLocationIcao || "—"} (after arrival)`
                : `best $/hr from ${playerLocationIcao || "—"}`}
            </span>
          </div>

          {/* Route + client */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-baseline gap-2 font-mono text-text-high">
              <span className="icao text-lg">{job.originIcao}</span>
              <span className="text-muted-faint" aria-hidden>
                ─▸
              </span>
              <span className="icao text-lg">{job.destinationIcao}</span>
              <span className="ml-2 font-mono tabular-nums text-[12px] text-muted">
                {job.distanceNm.toLocaleString()}
                <span className="ml-1 text-muted-dim">nm</span>
              </span>
            </div>
            <div className="flex items-center gap-2 truncate font-mono text-[11px]">
              <span className="truncate text-muted">
                {job.clientName ?? "Open Market"}
              </span>
              <span className="text-muted-faint">·</span>
              <span
                className={[
                  "uppercase tracking-callsign",
                  isFerry
                    ? "text-sky-300"
                    : isOpen
                    ? "text-muted-dim"
                    : "text-amber-deep",
                ].join(" ")}
              >
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Numbers + action */}
        <div className="flex shrink-0 items-center gap-5">
          <div className="flex flex-col items-end">
            {(() => {
              const net = job.fit.netPayHourCents;
              const gross = job.fit.payHourCents;
              // When the card is pivoted to "after arrival", the JobFit was
              // still computed from the player's current location — so its
              // net number bakes in a reposition leg (CYHZ → CYQM) that the
              // player isn't actually paying for, because they're already
              // flying that leg as the active job. Show gross instead and
              // label it honestly. Server-side pickRecommendedJobId also
              // scores by gross under pivot for the same reason.
              if (captionMode === "after-arrival") {
                if (gross == null) {
                  return (
                    <span className="font-mono tabular-nums text-2xl font-medium text-amber-glow">
                      —
                      <span className="ml-1 text-[11px] text-muted-dim">
                        /hr
                      </span>
                    </span>
                  );
                }
                return (
                  <span
                    title="Net pay/hr depends on what fleet you have at the arrival airport — shown as gross until you land."
                    className="font-mono tabular-nums text-2xl font-medium text-amber-glow"
                  >
                    {formatPay(gross)}
                    <span className="ml-1 text-[11px] text-muted-dim">
                      /hr gross
                    </span>
                  </span>
                );
              }
              if (net == null) {
                return (
                  <span className="font-mono tabular-nums text-2xl font-medium text-amber-glow">
                    —<span className="ml-1 text-[11px] text-muted-dim">/hr</span>
                  </span>
                );
              }
              const tip =
                gross != null && gross !== net
                  ? `Gross ${formatPay(gross)}/hr · fuel ${formatPay(job.fit.fuelCostCents)} · rental ${formatPay(job.fit.rentalCostCents)}`
                  : undefined;
              return (
                <span
                  title={tip}
                  className="font-mono tabular-nums text-2xl font-medium text-amber-glow"
                >
                  {formatPay(net)}
                  <span className="ml-1 text-[11px] text-muted-dim">
                    /hr net
                  </span>
                </span>
              );
            })()}
            <span className="font-mono tabular-nums text-[11px] text-muted">
              {formatPay(job.pay)} total
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span className="font-mono tabular-nums text-[13px] text-text-high">
              {expiresIn}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
              to expire
            </span>
          </div>

          <button
            type="button"
            onClick={() => onOpen(job)}
            className="inline-flex items-center gap-2 rounded-sm border border-amber-deep bg-amber-glow/[0.10] px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.18] hover:text-amber-warm"
          >
            ▸ Open briefing
          </button>
        </div>
      </div>
    </section>
  );
}
