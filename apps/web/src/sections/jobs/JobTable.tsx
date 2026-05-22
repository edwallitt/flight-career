import { useMemo, useState } from "react";
import {
  formatPay,
  formatPayloadType,
  formatRelativeFromNow,
  ROLE_LABEL,
} from "../../lib/formatters.js";
import type {
  FitStatus,
  JobRow,
  SortDir,
  SortKey,
  SortState,
} from "./types.js";

// Per-row fit glyph. Each maps to one of the four states produced by
// computeJobFit on the server. Visual hierarchy goes ready (filled emerald)
// → reposition (amber, hint of motion) → wont_fit (hollow amber, attention)
// → locked (slate, low-contrast). The same palette is reused in the legend.
const FIT_GLYPH: Record<
  FitStatus,
  { dot: string; ring: string; label: string }
> = {
  ready: {
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.55)]",
    ring: "ring-emerald-400/40",
    label: "Ready",
  },
  reposition: {
    dot: "bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.55)]",
    ring: "ring-amber-glow/40",
    label: "Reposition",
  },
  wont_fit: {
    dot: "bg-urgency-urgent shadow-[0_0_6px_rgba(232,160,76,0.45)]",
    ring: "ring-urgency-urgent/40",
    label: "Won't fit",
  },
  locked: {
    dot: "bg-ink-500",
    ring: "ring-ink-500/30",
    label: "Locked",
  },
};

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
  key: SortKey | "flags" | "fit";
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
  sortable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "fit", label: "Fit", sortable: false, align: "center" },
  { key: "client", label: "Client / Role", sortable: true },
  { key: "route", label: "Route", sortable: true },
  { key: "distance", label: "Dist", sortable: true, align: "right" },
  { key: "class", label: "Min", sortable: true, align: "center" },
  { key: "payload", label: "Payload", sortable: true, align: "right" },
  { key: "pay", label: "Pay", sortable: true, align: "right" },
  { key: "payHour", label: "$/hr", sortable: true, align: "right" },
  { key: "expires", label: "Window", sortable: true, align: "right" },
  { key: "urgency", label: "Urg.", sortable: true, align: "center" },
  { key: "flags", label: "Flags", sortable: false, align: "left" },
];

// fit / client / route / dist / min / payload / pay / $/hr / window / urg / flags
const GRID_TEMPLATE =
  "44px minmax(200px, 1.3fr) minmax(180px, 1fr) 80px 60px 110px 110px 100px 110px 70px 100px";

function compare(a: JobRow, b: JobRow, key: SortKey): number {
  switch (key) {
    case "client":
      return (a.clientName ?? "Open Market").localeCompare(
        b.clientName ?? "Open Market",
      );
    case "route":
      return (
        a.originIcao.localeCompare(b.originIcao) ||
        a.destinationIcao.localeCompare(b.destinationIcao)
      );
    case "class":
      return a.requiredClass.localeCompare(b.requiredClass);
    case "payload":
      return a.payloadLbs - b.payloadLbs;
    case "pay":
      return a.pay - b.pay;
    case "payHour":
      // null pay/hr (wont_fit, locked) sorts to the bottom either direction.
      // We tuck them at -1 so a descending sort still surfaces the best
      // doable job at the top, and they don't float above ready jobs when
      // someone clicks "ascending."
      return (a.fit.payHourCents ?? -1) - (b.fit.payHourCents ?? -1);
    case "distance":
      return a.distanceNm - b.distanceNm;
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

  if (job.jobType === "ferry") {
    flags.push({
      letter: "F",
      tone: "border-sky-500/70 text-sky-300 bg-sky-500/[0.08]",
      title: "Ferry / repositioning contract",
    });
  }

  if (job.weatherSensitivity === "strict") {
    flags.push({
      letter: "W",
      tone: "border-sky-500/60 text-sky-300",
      title: "Strict weather",
    });
  } else if (job.weatherSensitivity === "mild") {
    flags.push({
      letter: "w",
      tone: "border-sky-500/30 text-sky-400/70",
      title: "Mild weather",
    });
  }

  if (job.requiredCapabilities.includes("unpaved")) {
    flags.push({
      letter: "U",
      tone: "border-amber-deep text-amber-glow",
      title: "Unpaved",
    });
  }

  if (job.jobType !== "ferry") {
    if (job.payloadType === "medical") {
      flags.push({
        letter: "M",
        tone: "border-rose-500/60 text-rose-300",
        title: "Medical",
      });
    } else if (job.payloadType === "survey") {
      flags.push({
        letter: "S",
        tone: "border-emerald-500/60 text-emerald-300",
        title: "Survey",
      });
    } else if (job.payloadType === "mixed") {
      flags.push({
        letter: "X",
        tone: "border-violet-500/60 text-violet-300",
        title: "Mixed",
      });
    } else if (job.payloadType === "pax") {
      flags.push({
        letter: "P",
        tone: "border-zinc-500/60 text-zinc-300",
        title: "Passengers",
      });
    } else {
      flags.push({
        letter: "C",
        tone: "border-zinc-600/60 text-zinc-400",
        title: "Cargo",
      });
    }
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

interface GroupedRow {
  // The displayed job — first in the group, used for header rendering.
  primary: JobRow;
  // All members (primary included). length === 1 → not actually grouped.
  members: JobRow[];
}

// Group rows where every column the player would scan is identical and a
// quick batch decision makes sense. Pay variance under 1% is treated as
// "same"; anything bigger gets its own row so the player notices the
// outlier. Also: groups have to be at least 3 to collapse — two jobs is
// just two rows, not enough noise to justify the chevron.
function groupForBatching(jobs: JobRow[]): GroupedRow[] {
  const out: GroupedRow[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < jobs.length; i++) {
    const seed = jobs[i]!;
    if (consumed.has(seed.id)) continue;
    if (seed.jobType === "ferry") {
      out.push({ primary: seed, members: [seed] });
      consumed.add(seed.id);
      continue;
    }
    const group: JobRow[] = [seed];
    consumed.add(seed.id);
    for (let j = i + 1; j < jobs.length; j++) {
      const other = jobs[j]!;
      if (consumed.has(other.id)) continue;
      if (
        other.clientId === seed.clientId &&
        other.originIcao === seed.originIcao &&
        other.destinationIcao === seed.destinationIcao &&
        other.requiredClass === seed.requiredClass &&
        other.urgency === seed.urgency &&
        other.fit.status === seed.fit.status &&
        Math.abs(other.pay - seed.pay) / Math.max(1, seed.pay) < 0.01
      ) {
        group.push(other);
        consumed.add(other.id);
      }
    }
    if (group.length >= 3) {
      out.push({ primary: seed, members: group });
    } else {
      for (const m of group) out.push({ primary: m, members: [m] });
    }
  }
  return out;
}

export function JobTable({
  jobs,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  simNow,
  isLoading,
  recommendedJobId,
  flyableOnly,
  onPauseRefetch,
  onResumeRefetch,
  onTickNow,
  isTicking,
  onClearFilters,
}: {
  jobs: JobRow[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  selectedId: number | null;
  onSelect: (job: JobRow) => void;
  simNow: number;
  isLoading: boolean;
  recommendedJobId: number | null;
  flyableOnly: boolean;
  onPauseRefetch: () => void;
  onResumeRefetch: () => void;
  onTickNow: () => void;
  isTicking: boolean;
  onClearFilters: () => void;
}) {
  // Per-group expanded state. Collapsed groups still occupy one row that
  // routes onSelect to the first member.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sortedJobs = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => {
      const c = compare(a, b, sort.key as SortKey);
      return sort.dir === "asc" ? c : -c;
    });
    return sorted;
  }, [jobs, sort]);

  const grouped = useMemo(() => groupForBatching(sortedJobs), [sortedJobs]);

  const handleHeaderClick = (key: SortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({
        key,
        dir:
          key === "pay" ||
          key === "payHour" ||
          key === "payload" ||
          key === "distance"
            ? "desc"
            : "asc",
      });
    }
  };

  if (!isLoading && jobs.length === 0) {
    return (
      <EmptyState
        flyableOnly={flyableOnly}
        onTickNow={onTickNow}
        isTicking={isTicking}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseEnter={onPauseRefetch}
      onMouseLeave={onResumeRefetch}
    >
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
        {grouped.map((group, idx) => {
          const job = group.primary;
          const groupKey = `${job.clientId ?? "open"}|${job.originIcao}|${job.destinationIcao}|${job.requiredClass}|${job.urgency}`;
          const isGrouped = group.members.length > 1;
          const isExpanded = isGrouped && expanded.has(groupKey);
          return (
            <div
              key={groupKey + ":" + job.id}
              // Whitespace-separated id list so deep links from the Atlas can
              // find the group via `[data-job-ids~="42"]`. Includes every
              // member, so a collapsed group still scrolls into view when one
              // of its hidden members is the deep-link target.
              data-job-ids={group.members.map((m) => m.id).join(" ")}
            >
              <Row
                job={job}
                idx={idx}
                selected={
                  selectedId != null && group.members.some((m) => m.id === selectedId)
                }
                isRecommended={
                  recommendedJobId != null && job.id === recommendedJobId
                }
                groupSize={group.members.length}
                isGroupExpanded={isExpanded}
                onToggleGroup={
                  isGrouped
                    ? () => {
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(groupKey)) next.delete(groupKey);
                          else next.add(groupKey);
                          return next;
                        });
                      }
                    : undefined
                }
                onSelect={onSelect}
                simNow={simNow}
              />
              {isGrouped && isExpanded &&
                group.members.slice(1).map((m, j) => (
                  <Row
                    key={m.id}
                    job={m}
                    idx={idx + j + 1}
                    nested
                    selected={selectedId === m.id}
                    isRecommended={recommendedJobId === m.id}
                    groupSize={1}
                    onSelect={onSelect}
                    simNow={simNow}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  job,
  idx,
  selected,
  isRecommended,
  groupSize,
  isGroupExpanded,
  onToggleGroup,
  onSelect,
  simNow,
  nested,
}: {
  job: JobRow;
  idx: number;
  selected: boolean;
  isRecommended: boolean;
  groupSize: number;
  isGroupExpanded?: boolean;
  onToggleGroup?: () => void;
  onSelect: (job: JobRow) => void;
  simNow: number;
  nested?: boolean;
}) {
  const expiresIn = formatRelativeFromNow(job.expiresAt, simNow);
  const isFerry = job.jobType === "ferry";
  const isOpen = !isFerry && job.role === "open";
  const fitStatus = job.fit.status;
  const fit = FIT_GLYPH[fitStatus];
  const dim = fitStatus === "locked";

  return (
    <button
      type="button"
      onClick={() => onSelect(job)}
      className={[
        "group relative grid w-full items-center px-6 py-2.5 text-left transition-colors",
        "border-b border-ink-700/60",
        selected
          ? "bg-amber-glow/[0.06]"
          : isRecommended
          ? "bg-amber-glow/[0.04] hover:bg-amber-glow/[0.07]"
          : idx % 2 === 0
          ? "bg-transparent hover:bg-ink-700/40"
          : "bg-ink-800/30 hover:bg-ink-700/40",
        dim && "opacity-55",
        nested && "border-l border-ink-600/60",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      {/* Left accent bar — amber when selected, soft amber when recommended,
         transparent otherwise. */}
      <span
        className={[
          "pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] transition-all",
          selected
            ? "bg-amber-glow"
            : isRecommended
            ? "bg-amber-glow/60"
            : "bg-transparent",
        ].join(" ")}
      />

      {/* Fit indicator */}
      <div
        className="flex items-center justify-center gap-1.5"
        title={`${fit.label} · ${job.fit.reason}`}
      >
        {onToggleGroup ? (
          // Combined chevron + fit dot for grouped rows. Click chevron to
          // expand, click rest of row to drill into the primary job.
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroup();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onToggleGroup();
              }
            }}
            className="flex items-center gap-1 text-muted-faint hover:text-amber-glow"
            aria-label={
              isGroupExpanded ? "Collapse group" : "Expand group"
            }
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 9 9"
              className={[
                "transition-transform",
                isGroupExpanded ? "rotate-90" : "",
              ].join(" ")}
              aria-hidden
            >
              <path d="M2 1 L7 4.5 L2 8 Z" fill="currentColor" />
            </svg>
            <span className={["h-1.5 w-1.5 rounded-full", fit.dot].join(" ")} />
          </span>
        ) : (
          <span className={["h-1.5 w-1.5 rounded-full", fit.dot].join(" ")} />
        )}
      </div>

      {/* Client / role */}
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 truncate text-[13px] text-text-high">
          {job.clientName ?? <span className="text-muted">Open Market</span>}
          {groupSize > 1 && (
            <span className="rounded-sm border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-amber-glow">
              ×{groupSize}
            </span>
          )}
          {isRecommended && (
            <span
              className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.1] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-amber-glow"
              title="Highest pay/hr at your current location"
            >
              best
            </span>
          )}
        </span>
        <span
          className={[
            "mt-0.5 font-mono text-[10px] uppercase tracking-callsign",
            isFerry ? "text-sky-300" : isOpen ? "text-muted-dim" : "text-amber-deep",
          ].join(" ")}
        >
          {isFerry ? "Ferry" : (ROLE_LABEL[job.role] ?? job.role)}
        </span>
      </div>

      {/* Route */}
      <div className="flex min-w-0 flex-col font-mono text-text-high">
        <div className="flex items-center gap-2">
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
        {/* Fit reason — a small caption under the route. Tells the player
           why this row is dimmed (or why we picked the recommended one). */}
        <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {job.fit.reason}
        </div>
        {isFerry && job.ferryAircraft && (
          <div className="mt-0.5 flex items-baseline gap-2 truncate font-mono text-[10px] uppercase tracking-callsign text-sky-300/80">
            <span className="tracking-callsign text-sky-300">
              {job.ferryAircraft.tail}
            </span>
            <span className="text-muted-dim">·</span>
            <span className="truncate text-muted">
              {job.ferryAircraft.manufacturer} {job.ferryAircraft.model}
            </span>
          </div>
        )}
      </div>

      {/* Distance */}
      <div className="flex flex-col items-end">
        <span className="font-mono tabular-nums text-[13px] text-text-high">
          {job.distanceNm > 0 ? job.distanceNm.toLocaleString() : "—"}
          {job.distanceNm > 0 && (
            <span className="ml-1 text-muted-dim">nm</span>
          )}
        </span>
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
          {job.paxCount ? `${job.paxCount} pax` : formatPayloadType(job.payloadType)}
        </span>
      </div>

      {/* Pay */}
      <div className="flex flex-col items-end">
        <span className="font-mono tabular-nums text-[14px] font-medium text-amber-warm">
          {formatPay(job.pay)}
        </span>
      </div>

      {/* Pay per hour */}
      <div className="flex flex-col items-end">
        {job.fit.payHourCents != null ? (
          <span className="font-mono tabular-nums text-[13px] text-amber-glow">
            {formatPay(job.fit.payHourCents)}
            <span className="ml-1 text-muted-dim">/hr</span>
          </span>
        ) : (
          <span className="font-mono text-[12px] text-muted-faint">—</span>
        )}
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
          className={["h-1.5 w-1.5 rounded-full", URGENCY_DOT[job.urgency]].join(" ")}
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
}

function EmptyState({
  flyableOnly,
  onTickNow,
  isTicking,
  onClearFilters,
}: {
  flyableOnly: boolean;
  onTickNow: () => void;
  isTicking: boolean;
  onClearFilters: () => void;
}) {
  // Two empty paths: the board is genuinely empty (rare — pre-warm gives us
  // 12 jobs) or every job got filtered out. The "Flyable now" filter is the
  // most common reason — surface a one-click escape that lifts it. We also
  // always offer Force dispatch (the old dev-only Tick), Marketplace, and
  // Atlas so the player has somewhere to go.
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          board · empty
        </div>
        <div className="font-display text-2xl font-semibold tracking-tight text-text-high">
          {flyableOnly ? "Nothing flyable from here right now" : "No jobs available"}
        </div>
        <div className="text-sm text-muted">
          {flyableOnly
            ? "Your current aircraft can't fit any of the jobs on the board. Wait for the next tick, force a refresh, or widen the search."
            : "New jobs appear regularly. Tick the dispatch engine to populate the board now, or wait for the next 30-second cycle."}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {flyableOnly && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-text hover:border-amber-deep hover:text-amber-glow"
            >
              Show all reachable
            </button>
          )}
          <button
            type="button"
            onClick={onTickNow}
            disabled={isTicking}
            className="inline-flex items-center gap-2 rounded-sm border border-amber-deep bg-amber-glow/[0.06] px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow hover:bg-amber-glow/[0.12] disabled:opacity-40"
          >
            <span className="relative flex h-1.5 w-1.5">
              {isTicking && (
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/70" />
              )}
              <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
            </span>
            {isTicking ? "Ticking…" : "Force dispatch"}
          </button>
          <a
            href="/marketplace"
            className="inline-flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-text hover:border-amber-deep hover:text-amber-glow"
          >
            Marketplace
          </a>
          <a
            href="/atlas"
            className="inline-flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-text hover:border-amber-deep hover:text-amber-glow"
          >
            Atlas
          </a>
        </div>
      </div>
    </div>
  );
}
