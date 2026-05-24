import { useMemo } from "react";
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
// → locked (slate, low-contrast). Same palette is reused in the Fit header
// tooltip so the player has one vocabulary to learn.
const FIT_GLYPH: Record<
  FitStatus,
  { dot: string; ring: string; label: string; tip: string }
> = {
  ready: {
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.55)]",
    ring: "ring-emerald-400/40",
    label: "Ready",
    tip: "An aircraft you can dispatch is at the origin and fits payload, range, and any capability requirement.",
  },
  reposition: {
    dot: "bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.55)]",
    ring: "ring-amber-glow/40",
    label: "Reposition",
    tip: "An aircraft fits the job, but you'd need to ferry to the origin first.",
  },
  wont_fit: {
    dot: "bg-urgency-urgent shadow-[0_0_6px_rgba(232,160,76,0.45)]",
    ring: "ring-urgency-urgent/40",
    label: "Won't fit",
    tip: "You can fly the class, but your aircraft is over payload, short on range, or missing a capability like unpaved.",
  },
  locked: {
    dot: "bg-ink-500",
    ring: "ring-ink-500/30",
    label: "Locked",
    tip: "No aircraft of the required class is available to you here, or you lack the rating.",
  },
};

// Urgency is now folded into the Window column's color rather than wearing
// its own dot + label column. One signal, one place; the player's eye
// follows the time-to-expire and reads the urgency from how it's lit up.
const URGENCY_TEXT_TONE: Record<JobRow["urgency"], string> = {
  critical: "text-urgency-critical",
  urgent: "text-urgency-urgent",
  standard: "text-text-high",
  flexible: "text-muted",
};

interface ColumnDef {
  key: SortKey | "fit" | "client" | "route" | "load";
  label: string;
  align?: "left" | "right" | "center";
  sortable: boolean;
}

// 7 columns. fit / client / route / dist / load / $/hr / window.
// Three sortable: distance, $/hr (default desc), window.
const COLUMNS: ColumnDef[] = [
  { key: "fit", label: "Fit", sortable: false, align: "center" },
  { key: "client", label: "Client / Role", sortable: false },
  { key: "route", label: "Route", sortable: false },
  { key: "distance", label: "Dist", sortable: true, align: "right" },
  { key: "load", label: "Load", sortable: false, align: "right" },
  { key: "payHour", label: "$/hr", sortable: true, align: "right" },
  { key: "expires", label: "Window", sortable: true, align: "right" },
];

// fit / client / route / dist / load / $/hr / window
// Lost the 80px urgency column → window gets a touch more breathing room.
const GRID_TEMPLATE =
  "44px minmax(200px, 1.3fr) minmax(180px, 1fr) 80px 130px 140px 120px";

function compare(a: JobRow, b: JobRow, key: SortKey): number {
  switch (key) {
    case "payHour":
      // Net first (the honest number), fall back to gross when the server
      // couldn't price the candidate's fuel. null in both → -1, sinks to
      // the bottom either direction so wont_fit/locked don't float above
      // ready rows when sorted ascending.
      return (
        (a.fit.netPayHourCents ?? a.fit.payHourCents ?? -1) -
        (b.fit.netPayHourCents ?? b.fit.payHourCents ?? -1)
      );
    case "distance":
      return a.distanceNm - b.distanceNm;
    case "expires":
      return a.expiresAt - b.expiresAt;
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

// Compact legend rendered inside the Fit column header's tooltip. The Fit
// dot vocabulary is small enough that a permanent strip was paying rent
// the player stopped reading after their second session.
const FIT_TIP_LINES: { status: FitStatus }[] = [
  { status: "ready" },
  { status: "reposition" },
  { status: "wont_fit" },
  { status: "locked" },
];
function fitTooltip(): string {
  return FIT_TIP_LINES.map((l) => {
    const g = FIT_GLYPH[l.status];
    return `${g.label}: ${g.tip}`;
  }).join("\n\n");
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
  originScope,
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
  // The widest scope, "all", suppresses the flyable-specific empty message
  // because the player has explicitly asked to see everything.
  originScope: "here" | "flyable" | "all";
  onPauseRefetch: () => void;
  onResumeRefetch: () => void;
  onTickNow: () => void;
  isTicking: boolean;
  onClearFilters: () => void;
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
      // All three sortable columns are numeric — default to the direction
      // that puts the most useful answer at the top.
      // distance: ascending (short hops first).
      // payHour: descending (best return first).
      // expires: ascending (soonest to vanish first).
      onSortChange({
        key,
        dir: key === "payHour" ? "desc" : "asc",
      });
    }
  };

  if (!isLoading && jobs.length === 0) {
    return (
      <EmptyState
        originScope={originScope}
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
        {COLUMNS.map((col) => {
          // The Fit column header gets the legend tooltip — the only piece
          // of player education that used to live in the now-deleted
          // FitLegend strip.
          const title = col.key === "fit" ? fitTooltip() : undefined;
          if (!col.sortable) {
            return (
              <div
                key={col.key}
                title={title}
                className={[
                  "font-mono text-[10px] uppercase tracking-callsign text-muted-dim",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {col.key === "fit" ? (
                  <span className="inline-flex items-center gap-1 cursor-help">
                    {col.label}
                    <span
                      aria-hidden
                      className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-ink-500 text-[8px] text-muted-faint"
                    >
                      ?
                    </span>
                  </span>
                ) : (
                  col.label
                )}
              </div>
            );
          }
          return (
            <button
              key={col.key}
              type="button"
              onClick={() => handleHeaderClick(col.key as SortKey)}
              className={[
                "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim",
                col.align === "right" && "justify-end",
                col.align === "center" && "justify-center",
                "hover:text-text-high",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>{col.label}</span>
              <SortIndicator
                active={sort.key === col.key}
                dir={sort.dir}
              />
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedJobs.map((job, idx) => (
          <div key={job.id} data-job-ids={String(job.id)}>
            <Row
              job={job}
              idx={idx}
              selected={selectedId === job.id}
              isRecommended={recommendedJobId === job.id}
              onSelect={onSelect}
              simNow={simNow}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  job,
  idx,
  selected,
  isRecommended,
  onSelect,
  simNow,
}: {
  job: JobRow;
  idx: number;
  selected: boolean;
  isRecommended: boolean;
  onSelect: (job: JobRow) => void;
  simNow: number;
}) {
  const expiresIn = formatRelativeFromNow(job.expiresAt, simNow);
  const isFerry = job.jobType === "ferry";
  const isOpen = !isFerry && job.role === "open";
  const fitStatus = job.fit.status;
  const fit = FIT_GLYPH[fitStatus];
  const dim = fitStatus === "locked";
  // Unpaved is the only flag that meaningfully gates fit and isn't already
  // visible elsewhere (weather lives in the drawer, payload type lives in
  // the Load caption, ferry shows as a tag in the client cell).
  const isUnpaved = job.requiredCapabilities.includes("unpaved");

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
        className="flex items-center justify-center"
        title={`${fit.label} · ${job.fit.reason}`}
      >
        <span className={["h-1.5 w-1.5 rounded-full", fit.dot].join(" ")} />
      </div>

      {/* Client / role */}
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 truncate text-[13px] text-text-high">
          {job.clientName ?? <span className="text-muted">Open Market</span>}
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
        {/* Fit reason — only shown when there's something for the player to
           act on (reposition distance, payload gap, missing rating). When
           the row is "ready" we suppress it; "C172 ready at origin" was
           pure noise after the first few sessions. */}
        {fitStatus !== "ready" && (
          <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
            {job.fit.reason}
          </div>
        )}
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

      {/* Load — payload + required class + optional unpaved pill. The Min
          and Payload columns used to be separate, but a player reading
          left-to-right scans them as one decision ("can my aircraft take
          this?"), so we collapse them into one cell. */}
      <div className="flex flex-col items-end">
        <span className="flex items-baseline gap-2 font-mono tabular-nums text-[13px] text-text-high">
          <span>
            {job.payloadLbs.toLocaleString()}
            <span className="ml-1 text-muted-dim">lb</span>
          </span>
          <span className="text-[10px] uppercase tracking-callsign text-muted-dim">
            {job.requiredClass}
          </span>
          {isUnpaved && (
            <span
              title="Unpaved-capable aircraft required"
              className="rounded-sm border border-amber-deep px-1 font-mono text-[9px] uppercase tracking-callsign text-amber-glow"
            >
              U
            </span>
          )}
        </span>
        <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {job.paxCount ? `${job.paxCount} pax` : formatPayloadType(job.payloadType)}
        </span>
      </div>

      {/* Pay/hour — primary number is NET of fuel + rental. Absolute
          contract pay rides underneath; gross $/hr is in the title tooltip
          for the player who wants to inspect the cost breakdown. */}
      <div className="flex flex-col items-end">
        {(() => {
          const netCents = job.fit.netPayHourCents;
          const grossCents = job.fit.payHourCents;
          if (netCents == null) {
            return (
              <span className="font-mono text-[14px] text-muted-faint">—</span>
            );
          }
          const tipParts: string[] = [];
          if (grossCents != null && grossCents !== netCents) {
            tipParts.push(`Gross ${formatPay(grossCents)}/hr`);
          }
          if (job.fit.fuelCostCents > 0) {
            tipParts.push(`Fuel ${formatPay(job.fit.fuelCostCents)}`);
          }
          if (job.fit.rentalCostCents > 0) {
            tipParts.push(`Rental ${formatPay(job.fit.rentalCostCents)}`);
          }
          const tip = tipParts.length > 0 ? tipParts.join(" · ") : undefined;
          return (
            <span
              title={tip}
              className="font-mono tabular-nums text-[15px] font-medium text-amber-glow"
            >
              {formatPay(netCents)}
              <span className="ml-1 text-[10px] text-muted-dim">/hr net</span>
            </span>
          );
        })()}
        <span className="mt-0.5 font-mono tabular-nums text-[11px] text-muted">
          {formatPay(job.pay)} total
        </span>
      </div>

      {/* Window — urgency is folded in as text color. "Window" already
          names what this is, so we lose the "to expire" caption that used
          to ride underneath. Critical/urgent flame; standard reads as
          normal high-contrast; flexible dims a touch. */}
      <div
        className="flex flex-col items-end"
        title={`Urgency: ${job.urgency}`}
      >
        <span
          className={[
            "font-mono tabular-nums text-[13px]",
            URGENCY_TEXT_TONE[job.urgency],
          ].join(" ")}
        >
          {expiresIn}
        </span>
      </div>
    </button>
  );
}

function EmptyState({
  originScope,
  onTickNow,
  isTicking,
  onClearFilters,
}: {
  originScope: "here" | "flyable" | "all";
  onTickNow: () => void;
  isTicking: boolean;
  onClearFilters: () => void;
}) {
  // Three empty paths:
  //  - "here" filter on and nothing departs your current airport
  //  - "flyable" on and your fleet can't satisfy anything on the board
  //  - genuinely empty (rare — pre-warm gives us 12 jobs)
  //
  // The first two are the common ones, so we offer a one-click escape that
  // widens the scope to "all". Force dispatch + Marketplace + Atlas are
  // always-available fallbacks.
  const isFiltered = originScope !== "all";
  const headline =
    originScope === "here"
      ? "Nothing departing from here right now"
      : originScope === "flyable"
      ? "Nothing flyable from here right now"
      : "No jobs available";
  const sub =
    originScope === "here"
      ? "No contracts start at your current airport. Widen the search or reposition."
      : originScope === "flyable"
      ? "Your current aircraft can't fit any of the jobs on the board. Wait for the next tick, force a refresh, or widen the search."
      : "New jobs appear regularly. Tick the dispatch engine to populate the board now, or wait for the next 30-second cycle.";

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          board · empty
        </div>
        <div className="font-display text-2xl font-semibold tracking-tight text-text-high">
          {headline}
        </div>
        <div className="text-sm text-muted">{sub}</div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {isFiltered && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-text hover:border-amber-deep hover:text-amber-glow"
            >
              Show all jobs
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
