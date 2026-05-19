import type {
  ClaimOutcome,
  CompleteFlightOutput,
  EventSeverity,
  RiskTier,
} from "@flightcareer/shared";
import { INSURANCE_TIERS } from "@flightcareer/shared";
import { useEffect, useRef, useState } from "react";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";
import {
  RouteMap,
  type MapAirport,
  type MapRoute,
} from "../../components/map/RouteMap.js";

export interface CompletionSummaryRoute {
  originIcao: string;
  originName: string;
  originLat: number;
  originLon: number;
  actualIcao: string;
  actualName: string;
  actualLat: number;
  actualLon: number;
  plannedIcao: string;
  plannedName: string;
  plannedLat: number;
  plannedLon: number;
  isDiversion: boolean;
}

export interface CompletionUnscheduledEvent {
  eventId: number;
  riskTier: RiskTier;
  severity: EventSeverity;
  costCents: number;
  groundedDays: number;
  description: string;
  causeFactors: string[];
  scheduledCompletionAt: number | null;
}

export interface CompletionDispatcherSignoff {
  message: string;
  dispatcherName: string | null;
  sourceLabel: string | null;
}

export interface CompletionSummaryData extends CompleteFlightOutput {
  flightId: number;
  inspectionAlerts: string[];
  cashAppliedNow: number;
  unscheduledEvent: CompletionUnscheduledEvent | null;
  // Present only when an unscheduled event occurred on an owned aircraft —
  // the insurance split (or the uninsured / not-covered outcome).
  insuranceClaim: ClaimOutcome | null;
  dispatcherSignoff: CompletionDispatcherSignoff | null;
  route: CompletionSummaryRoute;
}

const ROLE_LABEL: Record<string, string> = {
  bush: "Bush",
  air_taxi: "Air Taxi",
  light_jet: "Light Jet",
};

function useEscape(onClose: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Lightweight count-up: animates from 0 to `target` over `durationMs`.
function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const sign = target >= 0 ? 1 : -1;
    const abs = Math.abs(target);

    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(abs * eased) * sign);
      if (k < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

function CornerTicks({ tone = "amber" }: { tone?: "amber" | "critical" }) {
  const cls =
    tone === "critical"
      ? "border-urgency-critical/70"
      : "border-amber-deep/70";
  return (
    <>
      <span className={`pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t ${cls}`} />
      <span className={`pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t ${cls}`} />
      <span className={`pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b ${cls}`} />
      <span className={`pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b ${cls}`} />
    </>
  );
}

function repLabel(scope: string): string {
  if (scope.startsWith("client:")) {
    const id = scope.slice("client:".length);
    return id
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  }
  return ROLE_LABEL[scope] ?? scope;
}

function ReputationRow({
  scope,
  delta,
}: {
  scope: string;
  delta: number;
}) {
  // Map -15..+15 onto a 0..100% bar centered at 50%.
  const max = 15;
  const clamped = Math.max(-max, Math.min(max, delta));
  const widthPct = (Math.abs(clamped) / max) * 50;
  const positive = delta >= 0;
  const color = positive ? "bg-amber-glow" : "bg-urgency-critical";

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex-1 font-mono text-tiny text-text">
        {repLabel(scope)}
      </div>
      <div className="relative h-1.5 w-40 rounded-full bg-ink-700">
        <span className="absolute left-1/2 top-0 h-full w-px bg-ink-500" />
        <span
          className={`absolute top-0 h-full ${color}`}
          style={{
            left: positive ? "50%" : `${50 - widthPct}%`,
            width: `${widthPct}%`,
            transition: "all 600ms ease-out",
          }}
        />
      </div>
      <div
        className={`w-10 text-right font-mono text-tiny tabular-nums ${
          positive ? "text-amber-glow" : "text-urgency-critical"
        }`}
      >
        {positive ? "+" : ""}
        {delta}
      </div>
    </div>
  );
}

function CashLine({
  label,
  cents,
  sign,
  emphasis,
}: {
  label: string;
  cents: number;
  sign: "+" | "-" | "";
  emphasis?: "net" | "negative" | "default";
}) {
  const animated = useCountUp(cents);
  const display = formatCash(Math.abs(animated));
  const colorCls =
    emphasis === "net"
      ? animated >= 0
        ? "text-amber-glow"
        : "text-urgency-critical"
      : emphasis === "negative"
        ? "text-urgency-urgent"
        : "text-text-high";
  const sizeCls = emphasis === "net" ? "text-[24px]" : "text-[15px]";

  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={`font-mono ${
          emphasis === "net"
            ? "text-tiny uppercase tracking-callsign text-amber-deep"
            : "label"
        }`}
      >
        {label}
      </span>
      <span className={`font-mono tabular-nums ${sizeCls} ${colorCls}`}>
        {sign}
        {display}
      </span>
    </div>
  );
}

type Banner = "success" | "diversion" | "failed";

function statusBanner(summary: CompletionSummaryData): Banner {
  if (summary.finalPay === 0) return "failed";
  if (summary.diversionAdjustment < 0) return "diversion";
  return "success";
}

const BANNER_CONFIG: Record<
  Banner,
  { label: string; barColor: string; tone: string }
> = {
  success: {
    label: "Job complete",
    barColor: "bg-amber-glow",
    tone: "text-amber-glow",
  },
  diversion: {
    label: "Diverted",
    barColor: "bg-urgency-urgent",
    tone: "text-urgency-urgent",
  },
  failed: {
    label: "Failed delivery",
    barColor: "bg-urgency-critical",
    tone: "text-urgency-critical",
  },
};

export function CompletionSummary({
  summary,
  onClose,
}: {
  summary: CompletionSummaryData;
  onClose: () => void;
}) {
  useEscape(onClose);

  const banner = statusBanner(summary);
  const cfg = BANNER_CONFIG[banner];

  // Round-trip profit on this job: revenue minus every cost (including the
  // fuel that was paid pre-flight, and any unscheduled-maintenance bill the
  // flight triggered). When an insurance policy covered part of that bill,
  // only the player-paid share hits the player's wallet — using the full
  // event cost here would overstate the loss and contradict both the
  // "Cash applied now" line and the insurance ledger shown in this modal.
  const eventCostBorne = summary.insuranceClaim
    ? summary.insuranceClaim.playerPaidCents
    : summary.unscheduledEvent?.costCents ?? 0;
  const profit = summary.grossRevenue - summary.totalCosts - eventCostBorne;

  // Pull origin/destination + block time from the canonical flight log entry.
  const { originIcao, destinationIcao, blockTimeMinutes } = summary.flightLogEntry;
  const blockH = Math.floor(blockTimeMinutes / 60);
  const blockM = blockTimeMinutes % 60;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Flight complete"
    >
      <div className="relative flex max-h-[92vh] w-[760px] max-w-[94vw] flex-col border border-ink-600 bg-ink-800 shadow-2xl">
        <CornerTicks tone={banner === "failed" ? "critical" : "amber"} />

        {/* Status bar */}
        <div className={`h-1 w-full ${cfg.barColor}`} />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 px-8 py-6">
          <div className="flex flex-col gap-1.5">
            <div
              className={`flex items-center gap-2 font-mono text-micro uppercase tracking-callsign ${cfg.tone}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cfg.barColor}`} />
              {cfg.label}
            </div>
            <div className="font-display text-[26px] font-semibold tracking-tight text-text-high">
              Flight logged
            </div>
            <div className="font-mono text-tiny text-muted-dim">
              Block time {blockH}h {String(blockM).padStart(2, "0")}m ·{" "}
              {summary.flightLogEntry.fuelBurnedGal.toFixed(1)} gal burned
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
          {/* Route — chart with diversion ghost when applicable */}
          <div className="flex flex-col gap-4 rounded-sm border border-ink-600 bg-ink-750 p-5">
            <div className="flex items-center justify-center gap-8">
              <div className="flex flex-col items-end">
                <span className="label">From</span>
                <span className="icao text-[32px] font-medium leading-none text-text-high">
                  {originIcao}
                </span>
                <span className="mt-1 max-w-[200px] truncate text-tiny text-muted-dim">
                  {summary.route.originName}
                </span>
              </div>
              <div className="flex flex-1 flex-col items-center">
                <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  flown
                </span>
                <span
                  className={[
                    "mt-1 font-mono text-[18px] uppercase tracking-callsign",
                    cfg.tone,
                  ].join(" ")}
                >
                  ▸▸▸
                </span>
                {summary.route.isDiversion && (
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-callsign text-urgency-urgent">
                    diverted from {summary.route.plannedIcao}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-start">
                <span className="label">To</span>
                <span className="icao text-[32px] font-medium leading-none text-text-high">
                  {destinationIcao}
                </span>
                <span className="mt-1 max-w-[200px] truncate text-tiny text-muted-dim">
                  {summary.route.actualName}
                </span>
              </div>
            </div>

            <RouteMap
              height={240}
              paddingPx={36}
              airports={buildSummaryAirports(summary.route)}
              routes={buildSummaryRoutes(summary.route)}
            />
          </div>

          {summary.dispatcherSignoff && (
            <DispatcherSignoffCard signoff={summary.dispatcherSignoff} />
          )}

          {summary.unscheduledEvent && (
            <UnscheduledEventCard
              event={summary.unscheduledEvent}
              claim={summary.insuranceClaim}
            />
          )}

          <div className="grid grid-cols-2 gap-5">
            {/* Financial breakdown */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-5">
              <div className="flex items-center gap-2">
                <span className="label">Receipt</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <div className="mt-2 divide-y divide-ink-700">
                <CashLine
                  label="Pay"
                  cents={summary.grossRevenue}
                  sign={summary.grossRevenue > 0 ? "+" : ""}
                />
                {summary.flightLogEntry.totalCost -
                  summary.destinationLandingFee -
                  summary.rentalCost -
                  summary.destinationRefuelCost >
                  0 && (
                  <CashLine
                    label="Fuel (pre-paid)"
                    cents={
                      summary.flightLogEntry.totalCost -
                      summary.destinationLandingFee -
                      summary.rentalCost -
                      summary.destinationRefuelCost
                    }
                    sign="-"
                    emphasis="negative"
                  />
                )}
                {summary.destinationLandingFee > 0 && (
                  <CashLine
                    label="Landing fee"
                    cents={summary.destinationLandingFee}
                    sign="-"
                    emphasis="negative"
                  />
                )}
                {summary.rentalCost > 0 && (
                  <CashLine
                    label="Rental"
                    cents={summary.rentalCost}
                    sign="-"
                    emphasis="negative"
                  />
                )}
                {summary.destinationRefuelCost > 0 && (
                  <CashLine
                    label="Refuel at dest"
                    cents={summary.destinationRefuelCost}
                    sign="-"
                    emphasis="negative"
                  />
                )}
                {eventCostBorne > 0 && (
                  <CashLine
                    label={
                      summary.insuranceClaim &&
                      summary.insuranceClaim.insurerPaidCents > 0
                        ? "Unscheduled maint. (after insurance)"
                        : "Unscheduled maint."
                    }
                    cents={eventCostBorne}
                    sign="-"
                    emphasis="negative"
                  />
                )}
                <div className="pt-1.5">
                  <CashLine
                    label="Round-trip profit"
                    cents={profit}
                    sign={profit >= 0 ? "+" : "-"}
                    emphasis="net"
                  />
                </div>
                <div className="pt-1.5">
                  <div className="flex items-center justify-between font-mono text-tiny">
                    <span className="label text-muted-dim">Cash applied now</span>
                    <span
                      className={`tabular-nums ${
                        summary.cashAppliedNow >= 0
                          ? "text-text"
                          : "text-urgency-critical"
                      }`}
                    >
                      {summary.cashAppliedNow >= 0 ? "+" : "-"}
                      {formatCash(Math.abs(summary.cashAppliedNow))}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-faint">
                    Pre-paid fuel was deducted at briefing; only the remainder
                    moves the cash account at completion.
                  </div>
                </div>
              </div>
            </div>

            {/* Reputation */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-5">
              <div className="flex items-center gap-2">
                <span className="label">Reputation</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              {summary.reputationDeltas.length === 0 ? (
                <div className="mt-3 font-mono text-tiny text-muted-dim">
                  No reputation change
                </div>
              ) : (
                <div className="mt-2 divide-y divide-ink-700">
                  {summary.reputationDeltas.map((d) => (
                    <ReputationRow
                      key={d.scope}
                      scope={d.scope}
                      delta={d.delta}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Aircraft impact */}
          {summary.aircraftUpdates && (
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center gap-2">
                <span className="label">Aircraft</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-4 font-mono text-tiny text-text">
                <div className="flex flex-col">
                  <span className="label">Now at</span>
                  <span className="icao mt-0.5 text-[15px] tracking-callsign text-text-high">
                    {summary.aircraftUpdates.newLocationIcao}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="label">Hours added</span>
                  <span className="mt-0.5 tabular-nums text-text-high">
                    +{summary.aircraftUpdates.blockHoursAdded.toFixed(2)} hrs
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="label">Fuel</span>
                  <span className="mt-0.5 tabular-nums text-text-high">
                    −{summary.aircraftUpdates.fuelBurnedGalDelta.toFixed(1)} gal
                    {summary.aircraftUpdates.fuelRefilledGalDelta > 0 && (
                      <span className="ml-1 text-amber-glow">
                        / +{summary.aircraftUpdates.fuelRefilledGalDelta.toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Inspection alerts */}
          {summary.inspectionAlerts.length > 0 && (
            <div className="rounded-sm border border-urgency-urgent/60 bg-urgency-urgent/[0.06] p-4">
              <div className="flex items-center gap-2">
                <span className="label text-urgency-urgent">Maintenance alert</span>
                <span className="h-px flex-1 bg-urgency-urgent/30" />
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-tiny text-text">
                {summary.inspectionAlerts.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-ink-600 bg-ink-850 px-8 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-amber-glow bg-amber-glow/[0.16] px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-amber-warm shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_0_22px_-6px_rgba(212,165,116,0.55)] hover:bg-amber-glow/[0.24]"
          >
            Continue ▸
          </button>
        </div>
      </div>
    </div>
  );
}

function DispatcherSignoffCard({
  signoff,
}: {
  signoff: CompletionDispatcherSignoff;
}) {
  const byline = formatSignoffByline(signoff);
  return (
    <div className="rounded-sm border-l-2 border-amber-deep/70 bg-ink-750 px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
        Dispatcher sign-off
      </div>
      <p className="mt-2 font-display text-[15px] italic leading-relaxed text-text-high">
        &ldquo;{signoff.message}&rdquo;
      </p>
      {byline && (
        <div className="mt-2 font-mono text-tiny text-muted">— {byline}</div>
      )}
    </div>
  );
}

function formatSignoffByline(signoff: CompletionDispatcherSignoff): string | null {
  if (signoff.dispatcherName && signoff.sourceLabel) {
    return `${signoff.dispatcherName}, ${signoff.sourceLabel}`;
  }
  return signoff.dispatcherName ?? signoff.sourceLabel ?? null;
}

function LedgerRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

interface EventTone {
  accent: string;
  rule: string;
}

function UnscheduledEventLedger({
  event,
  claim,
  tone,
}: {
  event: CompletionUnscheduledEvent;
  claim: ClaimOutcome | null;
  tone: EventTone;
}) {
  // Covered claim that actually paid out. Plain unsigned amounts that foot:
  // full = insurer + deductible + excess; you pay = deductible + excess. The
  // excess row only appears when the claim hit the per-claim ceiling — the
  // gap that would otherwise make the ledger not add up.
  if (claim && claim.covered && claim.insurerPaidCents > 0) {
    const excessOverCeilingCents =
      claim.playerPaidCents - claim.deductibleCents;
    return (
      <div className="mt-3 font-mono text-tiny">
        <LedgerRow
          label="Full cost"
          value={formatCash(claim.fullEventCostCents)}
          valueClass="text-text-high"
        />
        <LedgerRow
          label={`Insurance (${claim.policyTier ? INSURANCE_TIERS[claim.policyTier].label : "—"}) covered`}
          value={formatCash(claim.insurerPaidCents)}
          valueClass="text-emerald-300"
        />
        <LedgerRow
          label="Your deductible"
          value={formatCash(claim.deductibleCents)}
          valueClass="text-text-high"
        />
        {excessOverCeilingCents > 0 && (
          <LedgerRow
            label="Excess over claim ceiling"
            value={formatCash(excessOverCeilingCents)}
            valueClass="text-text-high"
          />
        )}
        <div className={`my-1.5 h-px ${tone.rule}`} />
        <LedgerRow
          label="You pay"
          value={formatCash(claim.playerPaidCents)}
          valueClass={`${tone.accent} font-semibold`}
        />
      </div>
    );
  }

  // Uninsured, severity-not-covered, or covered-but-under-deductible: the
  // player bears the full (or small) cost; one line plus the reason.
  const reason = !claim
    ? null
    : claim.policyTier === null
      ? "Uninsured — full cost borne by you."
      : claim.covered
        ? `Covered, but the cost fell under your ${formatCash(claim.deductibleCents)} deductible — borne by you in full.`
        : `${INSURANCE_TIERS[claim.policyTier].label} cover does not include ${event.severity} failures — full cost borne by you.`;
  return (
    <div className="mt-3 font-mono text-tiny">
      <LedgerRow
        label="Full cost"
        value={formatCash(event.costCents)}
        valueClass="text-text-high"
      />
      <div className={`my-1.5 h-px ${tone.rule}`} />
      <LedgerRow
        label="You pay"
        value={formatCash(claim ? claim.playerPaidCents : event.costCents)}
        valueClass={`${tone.accent} font-semibold`}
      />
      {reason && (
        <div className="mt-1.5 text-[11px] text-muted">{reason}</div>
      )}
    </div>
  );
}

function UnscheduledEventCard({
  event,
  claim,
}: {
  event: CompletionUnscheduledEvent;
  claim: ClaimOutcome | null;
}) {
  const isSevere = event.severity === "severe";
  const tone = isSevere
    ? {
        border: "border-urgency-critical/70",
        bg: "bg-urgency-critical/[0.06]",
        accent: "text-urgency-critical",
        rule: "bg-urgency-critical/30",
      }
    : {
        border: "border-urgency-urgent/60",
        bg: "bg-urgency-urgent/[0.06]",
        accent: "text-urgency-urgent",
        rule: "bg-urgency-urgent/30",
      };

  return (
    <div
      className={`rounded-sm border ${tone.border} ${tone.bg} p-5`}
    >
      <div className="flex items-center gap-2">
        <span className={`label ${tone.accent}`}>
          ⚠ Unscheduled maintenance
        </span>
        <span className={`h-px flex-1 ${tone.rule}`} />
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {event.severity}
        </span>
      </div>

      <div className="mt-3 font-display text-[18px] font-medium text-text-high">
        {event.description}
      </div>

      <UnscheduledEventLedger event={event} claim={claim} tone={tone} />

      {event.groundedDays > 0 && (
        <div className="mt-3 font-mono text-tiny">
          <div className="flex flex-col">
            <span className="label">Aircraft grounded</span>
            <span className="mt-0.5 tabular-nums text-text-high">
              {event.groundedDays} sim day{event.groundedDays === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="label">Contributing factors</div>
        {event.causeFactors.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-tiny text-text">
            {event.causeFactors.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-1 font-mono text-tiny text-muted">
            Routine wear and tear — nothing was overdue.
          </div>
        )}
      </div>

      {event.groundedDays > 0 && event.scheduledCompletionAt != null && (
        <div className="mt-3 font-mono text-tiny text-muted">
          Aircraft available again {formatSimDateTime(event.scheduledCompletionAt)}
        </div>
      )}
    </div>
  );
}

function buildSummaryAirports(route: CompletionSummaryRoute): MapAirport[] {
  const aps: MapAirport[] = [
    {
      icao: route.originIcao,
      lat: route.originLat,
      lon: route.originLon,
      label: route.originIcao,
      marker: "origin",
    },
    {
      icao: route.actualIcao,
      lat: route.actualLat,
      lon: route.actualLon,
      // Player just arrived here — render the pulsing "current" treatment.
      label: route.actualIcao,
      marker: "current",
    },
  ];
  if (route.isDiversion && route.plannedIcao !== route.actualIcao) {
    aps.push({
      icao: route.plannedIcao,
      lat: route.plannedLat,
      lon: route.plannedLon,
      label: `${route.plannedIcao} · planned`,
      marker: "destination",
    });
  }
  return aps;
}

function buildSummaryRoutes(route: CompletionSummaryRoute): MapRoute[] {
  const routes: MapRoute[] = [
    {
      fromIcao: route.originIcao,
      toIcao: route.actualIcao,
      style: "solid",
      tone: "primary",
    },
  ];
  if (route.isDiversion && route.plannedIcao !== route.actualIcao) {
    routes.push({
      fromIcao: route.originIcao,
      toIcao: route.plannedIcao,
      style: "dashed",
      tone: "ghost",
    });
  }
  return routes;
}
