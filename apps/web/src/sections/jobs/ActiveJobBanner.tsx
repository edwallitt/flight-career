import { formatSimDateTime } from "../../lib/formatters.js";
import type { JobBoardResult } from "./types.js";

type ActiveJob = NonNullable<JobBoardResult["activeJob"]>;

// Slim status strip surfaced above RecommendedJobCard when the player has
// an accepted / briefed / in-flight contract. The board would otherwise
// pretend every visit is a clean slate — players who land here mid-flight
// want to be reminded what they're committed to, and the recommendation
// below shifts context to "after you arrive at X" so the visual link is
// important.
//
// Click anywhere on the banner to jump to the active-job surface
// (/current). Kept link-flavoured rather than a button for muscle memory.

const STATE_LABEL: Record<ActiveJob["state"], string> = {
  accepted: "Accepted",
  briefed: "Briefed",
  in_progress: "In flight",
};

const STATE_TONE: Record<ActiveJob["state"], string> = {
  accepted: "border-amber-deep/60 bg-amber-glow/[0.06] text-amber-glow",
  briefed: "border-sky-500/60 bg-sky-500/[0.06] text-sky-300",
  in_progress: "border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-300",
};

export function ActiveJobBanner({
  activeJob,
}: {
  activeJob: ActiveJob | null;
}) {
  if (!activeJob) return null;
  const idStr = `#${activeJob.jobId.toString().padStart(5, "0")}`;
  return (
    <a
      href="/current"
      className="group flex items-center gap-4 border-b border-ink-600 bg-ink-850/80 px-6 py-2.5 transition-colors hover:bg-ink-800/70"
      aria-label={`Working on job ${idStr} to ${activeJob.destinationIcao}. Open current-job surface.`}
    >
      <span
        className={[
          "rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign",
          STATE_TONE[activeJob.state],
        ].join(" ")}
      >
        {STATE_LABEL[activeJob.state]}
      </span>
      <div className="flex items-baseline gap-2 font-mono text-text-high">
        <span className="text-[11px] uppercase tracking-callsign text-muted-dim">
          Working on
        </span>
        <span className="text-[12px] tabular-nums tracking-callsign">
          {idStr}
        </span>
        <span className="text-muted-faint" aria-hidden>
          ·
        </span>
        <span className="icao text-sm">{activeJob.originIcao}</span>
        <span className="text-muted-faint" aria-hidden>
          ─▸
        </span>
        <span className="icao text-sm text-amber-glow">
          {activeJob.destinationIcao}
        </span>
        {activeJob.clientName && (
          <>
            <span className="text-muted-faint" aria-hidden>
              ·
            </span>
            <span className="truncate text-[11px] text-muted">
              {activeJob.clientName}
            </span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {activeJob.etaSimMs != null && (
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted">
          ETA{" "}
          <span className="tabular-nums text-muted-dim">
            {formatSimDateTime(activeJob.etaSimMs)}
          </span>
        </span>
      )}
      <span
        aria-hidden
        className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim transition-colors group-hover:text-amber-glow"
      >
        Open ▸
      </span>
    </a>
  );
}
