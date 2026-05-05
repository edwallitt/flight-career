import { useMemo } from "react";
import {
  formatPay,
  formatPayloadType,
  formatRelativeFromNow,
  ROLE_LABEL,
} from "../../lib/formatters.js";
import type {
  JobRow,
  SortDir,
  SortKey,
  SortState,
} from "./types.js";

const URGENCY_COLOR: Record<JobRow["urgency"], string> = {
  critical: "text-urgency-critical",
  urgent: "text-urgency-urgent",
  standard: "text-urgency-standard",
  flexible: "text-urgency-flexible",
};

const URGENCY_DOT: Record<JobRow["urgency"], string> = {
  critical: "bg-urgency-critical shadow-[0_0_6px_rgba(225,92,79,0.65)]",
  urgent: "bg-urgency-urgent shadow-[0_0_6px_rgba(232,160,76,0.55)]",
  standard: "bg-urgency-standard",
  flexible: "bg-urgency-flexible",
};

interface ColumnDef {
  key: SortKey | "flags";
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
  sortable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "client", label: "Client / Role", sortable: true },
  { key: "route", label: "Route", sortable: true, width: "minmax(180px, 1fr)" },
  { key: "class", label: "Min", sortable: true, align: "center", width: "70px" },
  {
    key: "payload",
    label: "Payload",
    sortable: true,
    align: "right",
    width: "120px",
  },
  {
    key: "pay",
    label: "Pay",
    sortable: true,
    align: "right",
    width: "120px",
  },
  {
    key: "expires",
    label: "Window",
    sortable: true,
    align: "right",
    width: "130px",
  },
  { key: "urgency", label: "Urg.", sortable: true, align: "center", width: "80px" },
  { key: "flags", label: "Flags", sortable: false, align: "left", width: "112px" },
];

const GRID_TEMPLATE =
  "minmax(220px, 1.4fr) minmax(180px, 1fr) 70px 120px 120px 130px 80px 112px";

function compare(a: JobRow, b: JobRow, key: SortKey): number {
  switch (key) {
    case "client":
      return (a.clientName ?? "Open Market").localeCompare(
        b.clientName ?? "Open Market",
      );
    case "route":
      return a.originIcao.localeCompare(b.originIcao) ||
        a.destinationIcao.localeCompare(b.destinationIcao);
    case "class":
      return a.requiredClass.localeCompare(b.requiredClass);
    case "payload":
      return a.payloadLbs - b.payloadLbs;
    case "pay":
      return a.pay - b.pay;
    case "expires":
      return a.expiresAt - b.expiresAt;
    case "urgency": {
      const order: Record<string, number> = {
        critical: 0,
        urgent: 1,
        standard: 2,
        flexible: 3,
      };
      return order[a.urgency]! - order[b.urgency]!;
    }
  }
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span
      className={[
        "inline-flex flex-col leading-none transition-opacity",
        active ? "text-amber-glow" : "text-muted-faint opacity-60",
      ].join(" ")}
      aria-hidden
    >
      <svg width="8" height="5" viewBox="0 0 8 5">
        <path
          d="M0 5 L4 0 L8 5 Z"
          fill={active && dir === "asc" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="0.6"
        />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" style={{ marginTop: "1px" }}>
        <path
          d="M0 0 L8 0 L4 5 Z"
          fill={active && dir === "desc" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="0.6"
        />
      </svg>
    </span>
  );
}

function RowFlags({ job }: { job: JobRow }) {
  const flags: { letter: string; tone: string; title: string }[] = [];

  if (job.weatherSensitivity === "strict") {
    flags.push({ letter: "W", tone: "border-sky-500/60 text-sky-300", title: "Strict weather" });
  } else if (job.weatherSensitivity === "mild") {
    flags.push({ letter: "w", tone: "border-sky-500/30 text-sky-400/70", title: "Mild weather" });
  }

  if (job.requiredCapabilities.includes("unpaved")) {
    flags.push({ letter: "U", tone: "border-amber-deep text-amber-glow", title: "Unpaved" });
  }

  if (job.payloadType === "medical") {
    flags.push({ letter: "M", tone: "border-rose-500/60 text-rose-300", title: "Medical" });
  } else if (job.payloadType === "survey") {
    flags.push({ letter: "S", tone: "border-emerald-500/60 text-emerald-300", title: "Survey" });
  } else if (job.payloadType === "mixed") {
    flags.push({ letter: "X", tone: "border-violet-500/60 text-violet-300", title: "Mixed" });
  } else if (job.payloadType === "pax") {
    flags.push({ letter: "P", tone: "border-zinc-500/60 text-zinc-300", title: "Passengers" });
  } else {
    flags.push({ letter: "C", tone: "border-zinc-600/60 text-zinc-400", title: "Cargo" });
  }

  return (
    <div className="flex items-center gap-1">
      {flags.map((f, i) => (
        <span
          key={i}
          title={f.title}
          className={[
            "flex h-5 w-5 items-center justify-center rounded-sm border bg-ink-850 font-mono text-[10px]",
            f.tone,
          ].join(" ")}
        >
          {f.letter}
        </span>
      ))}
    </div>
  );
}

export function JobTable({
  jobs,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  simNow,
  isLoading,
}: {
  jobs: JobRow[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  selectedId: number | null;
  onSelect: (job: JobRow) => void;
  simNow: number;
  isLoading: boolean;
}) {
  const sortedJobs = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => {
      const c = compare(a, b, sort.key as SortKey);
      return sort.dir === "asc" ? c : -c;
    });
    return sorted;
  }, [jobs, sort]);

  const handleHeaderClick = (key: SortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({
        key,
        dir: key === "pay" || key === "payload" ? "desc" : "asc",
      });
    }
  };

  if (!isLoading && jobs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
            board · empty
          </div>
          <div className="font-display text-2xl font-semibold tracking-tight text-text-high">
            No jobs available
          </div>
          <div className="text-sm text-muted">
            New jobs appear regularly. Tick the engine to populate the board
            now, or wait for the next 30-second cycle.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div
        className="grid border-b border-ink-600 bg-ink-800 px-6 py-2.5"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            disabled={!col.sortable}
            onClick={() => col.sortable && handleHeaderClick(col.key as SortKey)}
            className={[
              "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim",
              col.align === "right" && "justify-end",
              col.align === "center" && "justify-center",
              col.sortable && "hover:text-text-high",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span>{col.label}</span>
            {col.sortable && (
              <SortIndicator
                active={sort.key === col.key}
                dir={sort.dir}
              />
            )}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedJobs.map((job, idx) => {
          const selected = selectedId === job.id;
          const expiresIn = formatRelativeFromNow(job.expiresAt, simNow);
          const isOpen = job.role === "open";

          return (
            <button
              key={job.id}
              type="button"
              onClick={() => onSelect(job)}
              className={[
                "group relative grid w-full items-center px-6 py-2.5 text-left transition-colors",
                "border-b border-ink-700/60",
                selected
                  ? "bg-amber-glow/[0.05]"
                  : idx % 2 === 0
                  ? "bg-transparent hover:bg-ink-700/40"
                  : "bg-ink-800/30 hover:bg-ink-700/40",
              ].join(" ")}
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {/* Selected indicator bar */}
              <span
                className={[
                  "pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] transition-all",
                  selected ? "bg-amber-glow" : "bg-transparent",
                ].join(" ")}
              />

              {/* Client / role */}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-text-high">
                  {job.clientName ?? (
                    <span className="text-muted">Open Market</span>
                  )}
                </span>
                <span
                  className={[
                    "mt-0.5 font-mono text-[10px] uppercase tracking-callsign",
                    isOpen ? "text-muted-dim" : "text-amber-deep",
                  ].join(" ")}
                >
                  {ROLE_LABEL[job.role] ?? job.role}
                </span>
              </div>

              {/* Route */}
              <div className="flex items-center gap-2 font-mono text-text-high">
                <span className="icao text-sm">{job.originIcao}</span>
                <span className="flex items-center gap-1 text-muted-faint">
                  <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden>
                    <line
                      x1="0"
                      y1="3"
                      x2="22"
                      y2="3"
                      stroke="currentColor"
                      strokeDasharray="2 2"
                    />
                  </svg>
                </span>
                <span className="icao text-sm">{job.destinationIcao}</span>
              </div>

              {/* Class */}
              <div className="text-center">
                <span className="font-mono text-[11px] uppercase tracking-callsign text-text-high">
                  {job.requiredClass}
                </span>
              </div>

              {/* Payload */}
              <div className="flex flex-col items-end">
                <span className="font-mono tabular-nums text-[13px] text-text-high">
                  {job.payloadLbs.toLocaleString()}
                  <span className="ml-1 text-muted-dim">lb</span>
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  {job.paxCount
                    ? `${job.paxCount} pax`
                    : formatPayloadType(job.payloadType)}
                </span>
              </div>

              {/* Pay */}
              <div className="flex flex-col items-end">
                <span className="font-mono tabular-nums text-[14px] font-medium text-amber-warm">
                  {formatPay(job.pay)}
                </span>
              </div>

              {/* Expires window */}
              <div className="flex flex-col items-end">
                <span className="font-mono tabular-nums text-[12px] text-text-high">
                  {expiresIn}
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  to expire
                </span>
              </div>

              {/* Urgency */}
              <div className="flex items-center justify-center gap-1.5">
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    URGENCY_DOT[job.urgency],
                  ].join(" ")}
                />
                <span
                  className={[
                    "font-mono text-[10px] uppercase tracking-callsign",
                    URGENCY_COLOR[job.urgency],
                  ].join(" ")}
                >
                  {job.urgency.slice(0, 4)}
                </span>
              </div>

              {/* Flags */}
              <div>
                <RowFlags job={job} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
