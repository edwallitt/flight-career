import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { assessRisk, RISK_TIER_LABEL, type RiskTier } from "@flightcareer/shared";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import {
  ENGINE_TONE_CLASS,
  getEngineHealthTone,
} from "../../lib/engineHealth.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

const RISK_CHIP_TONE: Record<RiskTier, string> = {
  healthy: "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300",
  monitor: "border-amber-deep/60 bg-amber-glow/[0.08] text-amber-warm",
  elevated: "border-urgency-urgent/60 bg-urgency-urgent/[0.10] text-urgency-urgent",
  high: "border-urgency-critical/60 bg-urgency-critical/[0.10] text-urgency-critical",
  critical:
    "border-urgency-critical bg-urgency-critical/[0.16] text-urgency-critical font-semibold",
};

type FleetItem = inferRouterOutputs<AppRouter>["hangar"]["fleet"][number];

const STATUS_TONE: Record<FleetItem["status"], string> = {
  available:
    "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300",
  in_flight:
    "border-amber-deep/60 bg-amber-glow/[0.10] text-amber-glow",
  committed:
    "border-amber-deep/60 bg-amber-glow/[0.10] text-amber-glow",
  in_maintenance:
    "border-urgency-critical/50 bg-urgency-critical/[0.08] text-urgency-critical",
};

const STATUS_LABEL: Record<FleetItem["status"], string> = {
  available: "Available",
  in_flight: "In flight",
  committed: "Committed",
  in_maintenance: "Maintenance",
};

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M8 1.5c-2.5 0-4.5 2-4.5 4.5C3.5 9.5 8 14.5 8 14.5S12.5 9.5 12.5 6c0-2.5-2-4.5-4.5-4.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Bar shows "remaining capacity": fill = value (0..1).
// When `warningBelow`/`criticalBelow` are provided, the bar shifts color as
// the remaining fraction falls below those thresholds — the smaller the
// remaining slice, the more alarming the color.
function Bar({
  value,
  warningBelow,
  criticalBelow,
}: {
  value: number;
  warningBelow?: number;
  criticalBelow?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);
  let color = "bg-emerald-400";
  if (criticalBelow != null && clamped < criticalBelow) {
    color = "bg-urgency-critical";
  } else if (warningBelow != null && clamped < warningBelow) {
    color = "bg-amber-glow";
  }
  return (
    <div className="h-1.5 w-32 overflow-hidden rounded-sm border border-ink-600 bg-ink-850">
      <div className={`${color} h-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatRow({
  label,
  value,
  bar,
}: {
  label: string;
  value: React.ReactNode;
  bar?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12px] tabular-nums text-text-high">
          {value}
        </span>
        {bar}
      </div>
    </div>
  );
}

type MaintenanceHighlight = "100hr" | "annual" | "overhaul";

export function FleetCard({
  aircraft,
  onInspect,
  onMaintenance,
  simNow,
  isSelected,
}: {
  aircraft: FleetItem;
  onInspect: () => void;
  onMaintenance: (highlight?: MaintenanceHighlight) => void;
  simNow: number;
  isSelected: boolean;
}) {
  const utils = trpc.useUtils();
  const refuelMutation = trpc.hangar.refuel.useMutation({
    onSuccess: () => {
      utils.hangar.fleet.invalidate();
      utils.hangar.aircraftById.invalidate();
      utils.career.get.invalidate();
    },
  });

  const inMaintenance = aircraft.status === "in_maintenance";
  const inProgress = aircraft.inProgressMaintenance;

  const daysSinceAnnual =
    365 + Math.max(0, (simNow - aircraft.annualDueAt) / SIM_DAY_MS);
  const risk = assessRisk({
    hoursSince100hr: aircraft.hoursSince100hr,
    hoursSinceAnnual: daysSinceAnnual,
    engineHoursSinceOverhaul: aircraft.engineHoursSinceOverhaul,
    tboHours: aircraft.tboHours,
    airframeHours: aircraft.airframeHours,
  });

  // Pick a maintenance type to spotlight when the player clicks the chip.
  // Engine wear is the most expensive to ignore, so it wins ties.
  function highlightFromRisk(): MaintenanceHighlight | undefined {
    const kinds = new Set(risk.factors.map((f) => f.factor));
    if (kinds.has("engine_tbo_ratio")) return "overhaul";
    if (kinds.has("days_since_annual")) return "annual";
    if (kinds.has("hours_since_100hr")) return "100hr";
    return undefined;
  }

  // Bar fill values are all "remaining capacity" fractions.
  const engineRemainingValue =
    aircraft.tboHours > 0
      ? Math.max(0, Math.min(1, aircraft.engineRemainingHours / aircraft.tboHours))
      : 0;
  const hundredHourValue = Math.max(
    0,
    Math.min(1, aircraft.hundredHourRemainingHours / 100),
  );
  const annualValue = Math.max(
    0,
    Math.min(1, aircraft.annualDaysRemaining / 365),
  );
  const fuelValue =
    aircraft.fuelCapacityGal > 0
      ? Math.max(0, Math.min(1, aircraft.fuelOnBoardGal / aircraft.fuelCapacityGal))
      : 0;
  const engineTone = getEngineHealthTone(
    aircraft.engineHoursSinceOverhaul,
    aircraft.tboHours,
  );

  const fuelNeededGal = Math.max(
    0,
    aircraft.fuelCapacityGal - aircraft.fuelOnBoardGal,
  );
  const refuelCost = Math.round(fuelNeededGal * aircraft.fuelPriceCentsPerGal);
  const canRefuel =
    aircraft.status === "available" &&
    aircraft.locationHasFuel &&
    fuelNeededGal > 0 &&
    !refuelMutation.isPending;

  const refuelDisabledReason = !aircraft.locationHasFuel
    ? `No ${aircraft.fuelType.toUpperCase()} here`
    : aircraft.status !== "available"
      ? STATUS_LABEL[aircraft.status]
      : fuelNeededGal <= 0
        ? "Tanks full"
        : null;

  const maintenanceDisabledReason =
    aircraft.status === "in_flight"
      ? "In flight"
      : aircraft.status === "committed"
        ? "Committed to a job"
        : null;
  const canBookMaintenance = !maintenanceDisabledReason;

  const maintenanceRemainingDays =
    inProgress && inProgress.scheduledCompletionAt > 0
      ? Math.max(
          0,
          Math.ceil((inProgress.scheduledCompletionAt - simNow) / SIM_DAY_MS),
        )
      : 0;

  return (
    <div
      className={[
        "relative flex flex-col rounded-sm border bg-ink-800",
        isSelected ? "border-amber-deep" : "border-ink-600",
      ].join(" ")}
    >
      <span className="pointer-events-none absolute left-2 top-2 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-2 top-2 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-2 bottom-2 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-2 bottom-2 block h-2 w-2 border-r border-b border-amber-deep/70" />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 border-b border-ink-600 px-5 pt-5 pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[20px] font-semibold tracking-callsign text-text-high">
              {aircraft.tailNumber}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
              · {aircraft.manufacturer} {aircraft.model}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
              {aircraft.aircraftClass}
            </span>
            <span className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted">
              {aircraft.fuelType}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMaintenance(highlightFromRisk())}
            disabled={!canBookMaintenance}
            title={
              risk.factors.length > 0
                ? risk.factors.map((f) => f.description).join("; ")
                : "Maintenance details"
            }
            className={[
              "rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-callsign transition-colors",
              RISK_CHIP_TONE[risk.tier],
              canBookMaintenance ? "cursor-pointer hover:brightness-125" : "cursor-not-allowed opacity-70",
            ].join(" ")}
          >
            {RISK_TIER_LABEL[risk.tier]}
          </button>
          <span
            className={[
              "rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-callsign",
              STATUS_TONE[aircraft.status],
            ].join(" ")}
          >
            {STATUS_LABEL[aircraft.status]}
          </span>
        </div>
      </div>

      {/* Location */}
      <div className="flex items-center gap-2 border-b border-ink-600 px-5 py-3">
        <span className="text-amber-glow">
          <PinIcon />
        </span>
        <span className="icao text-[14px] text-text-high">
          {aircraft.currentLocationIcao}
        </span>
        <span className="text-tiny text-muted">{aircraft.locationName}</span>
      </div>

      {inMaintenance && inProgress && (
        <div className="border-b border-urgency-critical/40 bg-urgency-critical/[0.06] px-5 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-callsign text-urgency-critical">
            In maintenance · {inProgress.label}
          </div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">
            Completes in {maintenanceRemainingDays} sim day
            {maintenanceRemainingDays === 1 ? "" : "s"} ·{" "}
            <span className="text-text-high">
              {formatCash(inProgress.cost)}
            </span>{" "}
            paid
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="px-5 py-3">
        <StatRow
          label="Airframe"
          value={`${Math.round(aircraft.airframeHours).toLocaleString()} hrs`}
        />
        <StatRow
          label="Engine"
          value={
            <>
              <span className={ENGINE_TONE_CLASS[engineTone]}>
                {Math.round(aircraft.engineHoursSinceOverhaul).toLocaleString()}
              </span>{" "}
              <span className="text-muted-dim">
                / {aircraft.tboHours.toLocaleString()} hrs
              </span>
            </>
          }
          bar={
            <Bar
              value={engineRemainingValue}
              warningBelow={0.15}
              criticalBelow={0.05}
            />
          }
        />
        <StatRow
          label="100-hour"
          value={
            aircraft.hundredHourRemainingHours <= 0 ? (
              <span className="text-urgency-critical">due now</span>
            ) : (
              <>
                in {aircraft.hundredHourRemainingHours.toFixed(1)} hrs
              </>
            )
          }
          bar={
            <Bar
              value={hundredHourValue}
              warningBelow={0.1}
              criticalBelow={0.02}
            />
          }
        />
        <StatRow
          label="Annual"
          value={
            aircraft.annualDaysRemaining <= 0 ? (
              <span className="text-urgency-critical">overdue</span>
            ) : (
              <>due in {aircraft.annualDaysRemaining} days</>
            )
          }
          bar={
            <Bar
              value={annualValue}
              // 30 days / 365 ≈ 0.082, 7 days / 365 ≈ 0.019
              warningBelow={30 / 365}
              criticalBelow={7 / 365}
            />
          }
        />
        <StatRow
          label="Fuel"
          value={
            <>
              {aircraft.fuelOnBoardGal.toFixed(0)}
              <span className="text-muted-dim">
                {" "}
                / {aircraft.fuelCapacityGal} gal
              </span>
            </>
          }
          bar={<Bar value={fuelValue} />}
        />
      </div>

      {/* Loan + value */}
      <div className="flex flex-col gap-2 border-t border-ink-600 px-5 py-3">
        {aircraft.loan && !aircraft.loan.fullyPaid && (
          <div className="flex items-baseline justify-between">
            <span className="label">Loan</span>
            <span className="font-mono text-[12px] tabular-nums text-text-high">
              {formatCash(aircraft.loan.remainingBalanceCents)}{" "}
              <span className="text-muted-dim">
                of {formatCash(aircraft.loan.principalCents)}
              </span>
              <span className="ml-2 text-muted-dim">·</span>{" "}
              <span className="text-text-high">
                {formatCash(aircraft.loan.monthlyPaymentCents)}
              </span>
              <span className="text-muted-dim">/mo</span>
              <span className="text-muted-dim">
                {" · "}
                {aircraft.loan.paymentsMade} of{" "}
                {aircraft.loan.originalTermMonths} paid
              </span>
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="label">Est. value</span>
          <span className="font-mono text-[12px] tabular-nums text-amber-warm">
            {formatCash(aircraft.estimatedValueCents)}
          </span>
        </div>
      </div>

      {/* Action row */}
      <div className="flex gap-2 border-t border-ink-600 bg-ink-850 px-5 py-3">
        <button
          type="button"
          disabled={!canRefuel}
          onClick={() =>
            refuelMutation.mutate({ aircraftId: aircraft.id })
          }
          className="flex-1 rounded-sm border border-amber-deep bg-amber-glow/[0.08] py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refuelMutation.isPending
            ? "Refueling…"
            : refuelDisabledReason
              ? `Refuel · ${refuelDisabledReason}`
              : `Refuel · ${formatCash(refuelCost)}`}
        </button>
        <button
          type="button"
          onClick={onInspect}
          className="flex-1 rounded-sm border border-ink-600 bg-ink-750 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-text-high"
        >
          Inspect
        </button>
        <button
          type="button"
          onClick={() => onMaintenance()}
          disabled={!canBookMaintenance}
          title={maintenanceDisabledReason ?? undefined}
          className="flex-1 rounded-sm border border-ink-600 bg-ink-750 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-text-high disabled:cursor-not-allowed disabled:opacity-40"
        >
          {inMaintenance ? "Maintenance · In progress" : "Maintenance"}
        </button>
      </div>
      {refuelMutation.data && !refuelMutation.data.ok && (
        <div className="border-t border-urgency-critical/40 bg-urgency-critical/[0.05] px-5 py-2 font-mono text-[11px] text-urgency-critical">
          {refuelMutation.data.error}
        </div>
      )}
    </div>
  );
}
