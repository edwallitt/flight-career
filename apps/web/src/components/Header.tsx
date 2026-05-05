import { trpc } from "../trpc.js";
import { formatCash, formatSimDateTime } from "../lib/formatters.js";

function StatBlock({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col px-5 py-2">
      <span className="label">{label}</span>
      <span
        className={[
          "mt-0.5 font-mono text-[15px] tabular-nums",
          emphasis ? "text-amber-glow" : "text-text-high",
        ].join(" ")}
      >
        {value}
      </span>
      {sub && (
        <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {sub}
        </span>
      )}
    </div>
  );
}

function VRule() {
  return <div className="self-stretch w-px bg-ink-600" />;
}

function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function Header() {
  const career = trpc.career.get.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const data = career.data;

  return (
    <header className="flex shrink-0 items-stretch border-b border-ink-600 bg-ink-800/60 backdrop-blur-sm">
      {/* Pilot block */}
      <div className="flex items-center gap-3 border-r border-ink-600 px-6 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-amber-deep bg-amber-glow/[0.06] font-mono text-sm font-medium text-amber-glow">
          {data?.pilotName?.charAt(0).toUpperCase() ?? "·"}
        </div>
        <div className="flex flex-col">
          <span className="label">Pilot</span>
          <span className="font-mono text-[13px] text-text-high">
            {data?.pilotName ?? "—"}
          </span>
        </div>
      </div>

      <StatBlock
        label="Cash on hand"
        emphasis
        value={data ? formatCash(data.cash) : "—"}
        sub="Operating capital"
      />
      <VRule />

      <StatBlock
        label="Position"
        value={
          <span className="icao text-text-high">
            {data?.currentLocationIcao ?? "—"}
          </span>
        }
        sub={data?.currentLocationName ?? ""}
      />
      <VRule />

      <StatBlock
        label="Sim time · UTC"
        value={data ? formatSimDateTime(data.simDateTime) : "—"}
        sub={
          data
            ? `Started ${new Date(data.startedAt).toISOString().slice(0, 10)}`
            : ""
        }
      />

      <div className="flex-1" />

      {/* Right rail: status + settings */}
      <div className="flex items-center gap-4 border-l border-ink-600 px-5">
        <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-muted-dim">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
          </span>
          Live · trpc
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
          aria-label="Settings"
          onClick={() => alert("Settings — coming soon")}
        >
          <CogIcon />
        </button>
      </div>
    </header>
  );
}
