import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";

type Snapshot = inferRouterOutputs<AppRouter>["career"]["snapshot"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatStartedDate(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function StatCol({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "amber";
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
        {label}
      </span>
      <span
        className={[
          "font-display text-[22px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "amber" ? "text-amber-warm" : "text-text-high",
        ].join(" ")}
      >
        {value}
      </span>
      {hint && (
        <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-dim">
          {hint}
        </span>
      )}
    </div>
  );
}

export function CareerHeader({ snapshot }: { snapshot: Snapshot | null }) {
  let careerDay: string = "—";
  let startedLabel = "—";
  let earnedRatings = "—";
  let pendingExams = 0;
  if (snapshot) {
    const days = Math.max(
      1,
      Math.floor((snapshot.simNow - snapshot.milestones.careerStartedAt) / MS_PER_DAY) + 1,
    );
    careerDay = String(days).padStart(3, "0");
    startedLabel = formatStartedDate(snapshot.milestones.careerStartedAt);
    const earned = snapshot.ratings.filter((r) => r.earned).length;
    earnedRatings = `${earned} / ${snapshot.ratings.length}`;
    pendingExams = snapshot.ratings.filter((r) => r.pendingExam != null).length;
  }

  return (
    <div className="relative border-b border-ink-600 bg-ink-850">
      {/* Full-width amber hairline at top */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-deep/40 to-transparent" />

      <div className="flex items-end justify-between px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · CRW
            <span className="text-amber-deep/40">·</span>
            <span className="text-muted-dim">Pilot dossier</span>
          </div>
          <h1 className="font-display text-[32px] font-semibold leading-none tracking-tight text-text-high">
            Career
          </h1>
          <p className="text-tiny text-muted">
            Ratings, standing, and lifetime telemetry
          </p>
        </div>

        {snapshot && (
          <div className="flex items-end gap-7">
            <StatCol label="Joined" value={startedLabel} hint="career start" />
            <StatCol
              label="Sim day"
              value={careerDay}
              hint="since start"
              tone="amber"
            />
            <StatCol
              label="Ratings"
              value={earnedRatings}
              hint="certified"
            />
            {pendingExams > 0 && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-[9px] uppercase tracking-callsign text-amber-glow">
                  Active
                </span>
                <span className="flex items-center gap-2 font-display text-[22px] font-semibold leading-none tabular-nums tracking-tight text-amber-warm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/50" />
                    <span className="relative h-2 w-2 rounded-full bg-amber-glow" />
                  </span>
                  {pendingExams}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-dim">
                  exam{pendingExams === 1 ? "" : "s"} booked
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
