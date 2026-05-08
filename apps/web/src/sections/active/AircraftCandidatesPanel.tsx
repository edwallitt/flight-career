import { useEffect, useMemo } from "react";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import {
  REASON_LABEL,
  type AircraftSelection,
  type RankedCandidate,
} from "./types.js";



function selectionKey(c: RankedCandidate): string {
  return c.candidate.source === "owned"
    ? `owned:${c.candidate.ownedAircraftId}`
    : `rental:${c.candidate.aircraftTypeId}@${c.candidate.currentLocationIcao}`;
}

function isSameSelection(
  c: RankedCandidate,
  sel: AircraftSelection | null,
): boolean {
  if (!sel) return false;
  if (sel.source === "owned" && c.candidate.source === "owned") {
    return sel.ownedAircraftId === c.candidate.ownedAircraftId;
  }
  if (sel.source === "rental" && c.candidate.source === "rental") {
    return sel.rentalAircraftTypeId === c.candidate.aircraftTypeId;
  }
  return false;
}

function selectionFromCandidate(c: RankedCandidate): AircraftSelection | null {
  if (c.candidate.source === "owned" && c.candidate.ownedAircraftId != null) {
    return {
      source: "owned",
      ownedAircraftId: c.candidate.ownedAircraftId,
      aircraftTypeId: c.candidate.aircraftTypeId,
    };
  }
  if (c.candidate.source === "rental") {
    return { source: "rental", rentalAircraftTypeId: c.candidate.aircraftTypeId };
  }
  return null;
}

function FuelLine({ fuel }: { fuel: RankedCandidate["fuel"] }) {
  if (fuel.source === "rental") {
    return (
      <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
        FUEL · wet rental, fueled at start
      </div>
    );
  }
  const cap = fuel.fuelCapacityGal;
  const cur = fuel.currentFuelGal;
  const pct = cap > 0 ? Math.max(0, Math.min(1, cur / cap)) : 0;
  const tone =
    fuel.status === "insufficient"
      ? "text-urgency-critical"
      : fuel.status === "top_up"
        ? "text-amber-warm"
        : "text-amber-glow/80";
  const barTone =
    fuel.status === "insufficient"
      ? "bg-urgency-critical"
      : fuel.status === "top_up"
        ? "bg-amber-warm"
        : "bg-amber-glow";
  const hint =
    fuel.status === "insufficient"
      ? "✗ Insufficient fuel"
      : fuel.status === "top_up"
        ? "⚠ Top up needed"
        : "✓ Fueled";
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
      <div className="flex items-center gap-2">
        <span>FUEL ·</span>
        <span className="tabular-nums text-muted">
          {Math.round(cur)}/{Math.round(cap)} gal
        </span>
        <span className="h-1 w-16 overflow-hidden rounded-sm bg-ink-700">
          <span
            className={`block h-full ${barTone}`}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
        <span className="text-muted-faint">
          · ~{Math.round(fuel.estimatedRangeNm)}nm
        </span>
      </div>
      <span className={tone}>{hint}</span>
    </div>
  );
}

// Primary reason a candidate is ineligible. Sorted so the most actionable
// (location, fuel) bubble up over the structural ones (rating, class).
const REASON_PRIORITY: Record<string, number> = {
  WRONG_LOCATION: 0,
  AIRCRAFT_UNAVAILABLE: 1,
  CANNOT_DISPATCH: 2,
  INSUFFICIENT_PAYLOAD: 3,
  INSUFFICIENT_RANGE: 4,
  RUNWAY_TOO_SHORT: 5,
  UNPAVED_INCAPABLE: 6,
  CAPABILITY_MISSING: 7,
  NOT_RATED: 8,
  CLASS_TOO_LOW: 9,
};

function ReasonChips({
  reasons,
  cannotDispatchReason,
}: {
  reasons: string[];
  cannotDispatchReason?: string;
}) {
  if (reasons.length === 0) return null;
  const sorted = [...reasons].sort(
    (a, b) => (REASON_PRIORITY[a] ?? 99) - (REASON_PRIORITY[b] ?? 99),
  );
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {sorted.map((r) => (
        <span
          key={r}
          title={r === "CANNOT_DISPATCH" ? cannotDispatchReason : undefined}
          className="rounded-sm border border-urgency-critical/40 bg-urgency-critical/[0.07] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-urgency-critical/90"
        >
          {REASON_LABEL[r] ?? r}
        </span>
      ))}
    </div>
  );
}

// "Best" label on the top-ranked eligible candidate so the player sees the
// recommended pick at a glance. Replaces the raw `rank -1000` sentinel that
// used to leak into the UI.
function EligibilityBadge({
  isEligible,
  isTop,
  isOwned,
}: {
  isEligible: boolean;
  isTop: boolean;
  isOwned: boolean;
}) {
  if (!isEligible) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
        ineligible
      </span>
    );
  }
  if (isTop) {
    return (
      <span className="rounded-sm border border-amber-deep/70 bg-amber-glow/[0.08] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
        {isOwned ? "best · owned" : "best match"}
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
      alternate
    </span>
  );
}

export function AircraftCandidatesPanel({
  jobId,
  selection,
  onSelectionChange,
  hasActiveJob,
}: {
  jobId: number;
  selection: AircraftSelection | null;
  onSelectionChange: (sel: AircraftSelection | null) => void;
  hasActiveJob: boolean;
}) {
  const query = trpc.aircraft.candidatesForJob.useQuery(
    { jobId },
    { enabled: jobId > 0 },
  );

  const ranked = useMemo(() => query.data?.ranked ?? [], [query.data]);

  // Auto-select the top eligible candidate when the job changes and no
  // selection is set. Don't fight the user — only seed; don't re-seed after
  // they've explicitly chosen.
  useEffect(() => {
    if (selection != null) return;
    const firstEligible = ranked.find((r) => r.eligibility.eligible);
    if (firstEligible) {
      const sel = selectionFromCandidate(firstEligible);
      if (sel) onSelectionChange(sel);
    }
  }, [jobId, ranked, selection, onSelectionChange]);

  if (query.isPending) {
    return (
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="label">Aircraft</div>
        <div className="mt-2 font-mono text-micro uppercase tracking-callsign text-muted-dim">
          loading fleet…
        </div>
      </div>
    );
  }

  const eligibleCount = ranked.filter((r) => r.eligibility.eligible).length;
  const topEligibleKey = (() => {
    const top = ranked.find((r) => r.eligibility.eligible);
    return top ? selectionKey(top) : null;
  })();

  return (
    <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="label">Select aircraft</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {eligibleCount}/{ranked.length} eligible
        </span>
      </div>

      {hasActiveJob && (
        <div className="mt-3 rounded-sm border border-amber-deep/60 bg-amber-glow/[0.05] px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
          You already have an active job. Cancel it to accept another.
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {ranked.length === 0 && (
          <div className="rounded-sm border border-ink-600 bg-ink-800 p-3 text-tiny text-muted-dim">
            No aircraft within reach.
          </div>
        )}
        {ranked.map((c) => {
          const k = selectionKey(c);
          const isSelected = isSameSelection(c, selection);
          const isOwned = c.candidate.source === "owned";
          const isEligible = c.eligibility.eligible;

          return (
            <button
              key={k}
              type="button"
              disabled={!isEligible || hasActiveJob}
              onClick={() => {
                const sel = selectionFromCandidate(c);
                if (sel) onSelectionChange(sel);
              }}
              className={[
                "group relative flex flex-col gap-1 rounded-sm border px-3 py-2 text-left transition-colors",
                isEligible
                  ? isSelected
                    ? "border-amber-glow bg-amber-glow/[0.08] shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_0_18px_-6px_rgba(212,165,116,0.4)]"
                    : "border-ink-600 bg-ink-800 hover:border-amber-deep/70 hover:bg-ink-750"
                  : "border-ink-600 bg-ink-800/60 opacity-60",
                hasActiveJob && "cursor-not-allowed",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {/* selection cursor */}
              {isSelected && (
                <span className="pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-amber-glow" />
              )}

              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] uppercase tracking-callsign text-muted-dim">
                    {isOwned ? "OWN" : "RNT"}
                  </span>
                  <span className="font-display text-[14px] font-medium text-text-high">
                    {c.display.manufacturer} {c.display.model}
                  </span>
                  {c.candidate.tailNumber && (
                    <span className="font-mono text-tiny text-muted">
                      · {c.candidate.tailNumber}
                    </span>
                  )}
                  <span
                    className={[
                      "ml-1 rounded-sm border px-1 py-px font-mono text-[10px] uppercase tracking-callsign",
                      c.candidate.cls === "JET"
                        ? "border-amber-deep/60 text-amber-glow"
                        : "border-ink-500 text-muted",
                    ].join(" ")}
                  >
                    {c.candidate.cls}
                  </span>
                </div>
                <span className="font-mono text-tiny tabular-nums text-text">
                  {c.candidate.source === "rental" ? (
                    <>
                      <span className="text-muted-dim">rent </span>
                      <span className="text-amber-warm">
                        {formatCash(c.display.rentalRatePerHour)}
                      </span>
                      <span className="text-muted-dim">/h</span>
                    </>
                  ) : (
                    <span className="text-muted-dim">owned</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 font-mono text-tiny text-muted-dim">
                <div className="flex items-center gap-3">
                  <span>
                    @ <span className="icao text-muted">{c.candidate.currentLocationIcao}</span>
                  </span>
                  <span>· rng {c.candidate.rangeNm}nm</span>
                  <span>· pld {c.candidate.maxPayloadLbs}lb</span>
                </div>
                <EligibilityBadge
                  isEligible={isEligible}
                  isTop={k === topEligibleKey}
                  isOwned={isOwned}
                />
              </div>

              <FuelLine fuel={c.fuel} />

              {!isEligible && (
                <ReasonChips
                  reasons={c.eligibility.reasons}
                  cannotDispatchReason={c.cannotDispatchReason}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

