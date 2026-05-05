import { trpc } from "../../trpc.js";

const STATE_LABEL: Record<string, string> = {
  accepted: "Accepted",
  briefed: "Briefed",
  in_progress: "In flight",
};

const STATE_TONE: Record<string, string> = {
  accepted:
    "border-amber-deep bg-amber-glow/[0.10] text-amber-glow shadow-[0_0_0_1px_rgba(212,165,116,0.35),0_0_18px_-6px_rgba(212,165,116,0.45)]",
  briefed:
    "border-amber-glow bg-amber-glow/[0.16] text-amber-warm shadow-[0_0_0_1px_rgba(212,165,116,0.55),0_0_22px_-5px_rgba(212,165,116,0.55)]",
  in_progress:
    "border-amber-glow bg-amber-glow/[0.20] text-text-high shadow-[0_0_0_1px_rgba(212,165,116,0.65),0_0_22px_-4px_rgba(212,165,116,0.65)]",
};

export function ActiveJobPill({ onOpen }: { onOpen: () => void }) {
  const active = trpc.lifecycle.getActiveJob.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const data = active.data;
  if (!data) return null;

  const tone = STATE_TONE[data.state] ?? STATE_TONE.accepted!;
  const stateLabel = STATE_LABEL[data.state] ?? data.state;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "group relative flex items-center gap-3 rounded-sm border px-3 py-1.5 transition-colors",
        tone,
      ].join(" ")}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/60" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
        Active
      </span>
      <span className="flex items-center gap-2 font-mono text-[12px]">
        <span className="icao tracking-callsign text-text-high">
          {data.job.originIcao}
        </span>
        <span className="text-amber-deep">→</span>
        <span className="icao tracking-callsign text-text-high">
          {data.job.destinationIcao}
        </span>
      </span>
      <span className="hidden font-display text-[12px] text-muted lg:inline">
        · {data.aircraft.manufacturer} {data.aircraft.model}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-callsign text-muted">
        · {stateLabel}
      </span>
      <span className="font-mono text-[10px] text-amber-deep">▸</span>
    </button>
  );
}
