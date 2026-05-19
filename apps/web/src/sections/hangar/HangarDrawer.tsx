import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";
import {
  ENGINE_TONE_CLASS,
  getEngineHealthTone,
} from "../../lib/engineHealth.js";

type Detail = NonNullable<
  inferRouterOutputs<AppRouter>["hangar"]["aircraftById"]
>;

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3 3 L13 13 M13 3 L3 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Field({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className={[
        "flex flex-col gap-0.5",
        align === "right" && "items-end text-right",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="label">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-text-high">
        {children}
      </span>
    </div>
  );
}

function projectPaymentSchedule(
  detail: Detail,
  count: number,
): {
  index: number;
  due: number;
  payment: number;
  remaining: number;
}[] {
  if (!detail.loan) return [];
  const out: {
    index: number;
    due: number;
    payment: number;
    remaining: number;
  }[] = [];
  let balance = detail.loan.remainingBalanceCents;
  let due = detail.loan.nextPaymentDue;
  const monthlyRate = detail.loan.interestRateBps / 10_000 / 12;
  const SIM_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < count && balance > 0; i++) {
    const interest = Math.round(balance * monthlyRate);
    let principal = detail.loan.monthlyPaymentCents - interest;
    if (principal < 0) principal = 0;
    let payment = detail.loan.monthlyPaymentCents;
    if (principal >= balance) {
      principal = balance;
      payment = balance + interest;
    }
    balance = Math.max(0, balance - principal);
    out.push({
      index: detail.loan.paymentsMade + i + 1,
      due,
      payment,
      remaining: balance,
    });
    due += SIM_MONTH_MS;
  }
  return out;
}

export function HangarDrawer({
  aircraftId,
  onClose,
  onRequestSell,
  onRequestInsurance,
}: {
  aircraftId: number | null;
  onClose: () => void;
  onRequestSell: (id: number) => void;
  onRequestInsurance: (id: number) => void;
}) {
  const open = aircraftId != null;
  const utils = trpc.useUtils();
  const detail = trpc.hangar.aircraftById.useQuery(
    { id: aircraftId ?? -1 },
    { enabled: aircraftId != null },
  );
  const aircraft = detail.data ?? null;

  const refuelMutation = trpc.hangar.refuel.useMutation({
    onSuccess: () => {
      utils.hangar.fleet.invalidate();
      utils.hangar.aircraftById.invalidate();
      utils.career.get.invalidate();
    },
  });

  const fuelNeededGal = aircraft
    ? Math.max(0, aircraft.fuelCapacityGal - aircraft.fuelOnBoardGal)
    : 0;
  const refuelCost = aircraft
    ? Math.round(fuelNeededGal * aircraft.fuelPriceCentsPerGal)
    : 0;
  const canRefuel =
    aircraft != null &&
    aircraft.status === "available" &&
    aircraft.locationHasFuel &&
    fuelNeededGal > 0 &&
    !refuelMutation.isPending;

  const upcoming = aircraft ? projectPaymentSchedule(aircraft, 6) : [];

  return (
    <aside
      className={[
        "absolute right-0 top-0 bottom-0 z-30 flex w-[460px] flex-col border-l border-ink-600 bg-ink-800 shadow-2xl",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

      <div className="flex items-start justify-between border-b border-ink-600 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Hangar · #{String(aircraftId ?? "").padStart(5, "0")}
          </div>
          <div className="font-display text-xl font-semibold tracking-tight text-text-high">
            {aircraft?.tailNumber ?? "—"}
          </div>
          {aircraft && (
            <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
              {aircraft.manufacturer} {aircraft.model} ·{" "}
              <span className="text-amber-deep">{aircraft.aircraftClass}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {!aircraft ? (
          <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
            {detail.isPending ? "loading…" : "no aircraft"}
          </div>
        ) : (
          <>
            {/* Specifications */}
            <Section title="Specifications">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Cruise speed">
                  {aircraft.cruiseSpeedKts} kts
                </Field>
                <Field label="Fuel burn" align="right">
                  {aircraft.fuelBurnGph.toFixed(1)} gph
                </Field>
                <Field label="Range">
                  {aircraft.rangeNm.toLocaleString()} nm
                </Field>
                <Field label="MTOW" align="right">
                  {aircraft.mtowLbs.toLocaleString()} lbs
                </Field>
                <Field label="Max payload">
                  {aircraft.maxPayloadLbs.toLocaleString()} lbs
                </Field>
                <Field label="Unpaved" align="right">
                  {aircraft.unpavedCapable ? "yes" : "no"}
                </Field>
                <Field label="Fuel type">
                  {aircraft.fuelType.toUpperCase()}
                </Field>
                <Field label="TBO" align="right">
                  {aircraft.tboHours.toLocaleString()} hrs
                </Field>
              </div>
            </Section>

            {/* Current state */}
            <Section title="Current state">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Status">
                  <span className="uppercase tracking-callsign text-amber-glow">
                    {aircraft.status.replace("_", " ")}
                  </span>
                </Field>
                <Field label="Location" align="right">
                  <span className="icao text-text-high">
                    {aircraft.currentLocationIcao}
                  </span>
                </Field>
                <Field label="Airframe">
                  {Math.round(aircraft.airframeHours).toLocaleString()} hrs
                </Field>
                <Field label="Engine since OH" align="right">
                  <span
                    className={
                      ENGINE_TONE_CLASS[
                        getEngineHealthTone(
                          aircraft.engineHoursSinceOverhaul,
                          aircraft.tboHours,
                        )
                      ]
                    }
                  >
                    {Math.round(
                      aircraft.engineHoursSinceOverhaul,
                    ).toLocaleString()}
                  </span>{" "}
                  hrs
                </Field>
                <Field label="100-hr remaining">
                  {aircraft.hundredHourRemainingHours.toFixed(1)} hrs
                </Field>
                <Field label="Annual due in" align="right">
                  {aircraft.annualDaysRemaining} days
                </Field>
                <Field label="Fuel on board">
                  {aircraft.fuelOnBoardGal.toFixed(1)} /{" "}
                  {aircraft.fuelCapacityGal} gal
                </Field>
                <Field label="Fuel price here" align="right">
                  {aircraft.locationHasFuel
                    ? `${formatCash(aircraft.fuelPriceCentsPerGal)}/gal`
                    : "—"}
                </Field>
              </div>
            </Section>

            {/* Loan */}
            {aircraft.loan && aircraft.loan.fullyPaid ? (
              <Section title="Loan">
                <div className="font-mono text-[12px] text-emerald-300">
                  Loan paid off — fully owned
                  {aircraft.loan.paidOffAt != null && (
                    <span className="ml-2 text-muted-dim">
                      · {formatSimDateTime(aircraft.loan.paidOffAt)}
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px] text-muted-dim">
                  <Field label="Original">
                    {formatCash(aircraft.loan.principalCents)}
                  </Field>
                  <Field label="Term" align="right">
                    {aircraft.loan.originalTermMonths} mo
                  </Field>
                </div>
              </Section>
            ) : aircraft.loan ? (
              <Section title="Loan">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Remaining">
                    {formatCash(aircraft.loan.remainingBalanceCents)}
                  </Field>
                  <Field label="Original" align="right">
                    {formatCash(aircraft.loan.principalCents)}
                  </Field>
                  <Field label="Monthly">
                    {formatCash(aircraft.loan.monthlyPaymentCents)}
                  </Field>
                  <Field label="APR" align="right">
                    {(aircraft.loan.interestRateBps / 100).toFixed(2)}%
                  </Field>
                  <Field label="Payments">
                    {aircraft.loan.paymentsMade} of{" "}
                    {aircraft.loan.originalTermMonths}
                  </Field>
                  <Field label="LTV" align="right">
                    {aircraft.loanLtvRatio == null
                      ? "—"
                      : `${Math.round(aircraft.loanLtvRatio * 100)}%`}
                  </Field>
                </div>

                {upcoming.length > 0 && (
                  <div className="mt-4">
                    <div className="label mb-2">Next payments</div>
                    <ul className="flex flex-col divide-y divide-ink-600 rounded-sm border border-ink-600 bg-ink-850/40">
                      {upcoming.map((p) => (
                        <li
                          key={p.index}
                          className="flex items-baseline justify-between px-3 py-1.5 font-mono text-[11px]"
                        >
                          <span className="text-muted-dim">
                            #{p.index} · {formatSimDateTime(p.due)}
                          </span>
                          <span className="tabular-nums text-text-high">
                            {formatCash(p.payment)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            ) : (
              <Section title="Loan">
                <div className="font-mono text-[12px] text-muted-dim">
                  Owned outright — no loan against this aircraft.
                </div>
              </Section>
            )}

            {/* Recurring costs */}
            <Section title="Monthly fixed costs">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Hangarage">
                  {formatCash(aircraft.hangarageMonthlyCents)}
                </Field>
                <Field label="Insurance" align="right">
                  {formatCash(aircraft.insuranceMonthlyCents)}
                </Field>
                {aircraft.loan && !aircraft.loan.fullyPaid && (
                  <>
                    <Field label="Loan payment">
                      {formatCash(aircraft.loan.monthlyPaymentCents)}
                    </Field>
                    <div />
                  </>
                )}
                <div className="col-span-2 flex items-baseline justify-between border-t border-ink-600 pt-2">
                  <span className="label">Total / month</span>
                  <span className="font-mono text-[14px] tabular-nums text-amber-warm">
                    {formatCash(aircraft.monthlyFixedCostsCents)}
                  </span>
                </div>
              </div>
            </Section>

            {/* Maintenance history */}
            <Section title="Maintenance history">
              <div className="font-mono text-[12px] text-muted-dim">
                No maintenance recorded yet.
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-2">
                  <div className="label">100-hr</div>
                  <div className="mt-0.5 font-mono text-[12px] tabular-nums text-text-high">
                    {formatCash(aircraft.hundredHourCostCents)}
                  </div>
                </div>
                <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-2">
                  <div className="label">Annual</div>
                  <div className="mt-0.5 font-mono text-[12px] tabular-nums text-text-high">
                    {formatCash(aircraft.annualCostCents)}
                  </div>
                </div>
                <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-2">
                  <div className="label">Overhaul</div>
                  <div className="mt-0.5 font-mono text-[12px] tabular-nums text-text-high">
                    {formatCash(aircraft.overhaulCostCents)}
                  </div>
                </div>
              </div>
            </Section>

            {/* Purchase */}
            <Section title="Purchase">
              <div className="font-mono text-[12px] text-text-high">
                Purchased {formatSimDateTime(aircraft.purchasedAt)} for{" "}
                <span className="text-amber-warm">
                  {formatCash(aircraft.purchasePriceCents)}
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-dim">
                Estimated value today:{" "}
                <span className="text-text-high">
                  {formatCash(aircraft.estimatedValueCents)}
                </span>
              </div>
            </Section>

            {refuelMutation.data && !refuelMutation.data.ok && (
              <div className="rounded-sm border border-urgency-critical/50 bg-urgency-critical/[0.05] px-3 py-2 font-mono text-[11px] text-urgency-critical">
                {refuelMutation.data.error}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 border-t border-ink-600 bg-ink-800 px-6 py-4">
        <button
          type="button"
          disabled={!canRefuel}
          onClick={() =>
            aircraft && refuelMutation.mutate({ aircraftId: aircraft.id })
          }
          className="flex-1 rounded-sm border border-amber-deep bg-amber-glow/[0.08] py-3 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refuelMutation.isPending
            ? "Refueling…"
            : aircraft && fuelNeededGal > 0 && aircraft.locationHasFuel
              ? `Refuel · ${formatCash(refuelCost)}`
              : "Refuel"}
        </button>
        <button
          type="button"
          disabled={!aircraft}
          onClick={() => aircraft && onRequestInsurance(aircraft.id)}
          className="flex-1 rounded-sm border border-ink-600 bg-ink-750 py-3 font-mono text-[12px] uppercase tracking-callsign text-muted hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {aircraft?.insurance
            ? `Insurance · ${aircraft.insurance.tier}`
            : "Insurance"}
        </button>
        <button
          type="button"
          disabled={!aircraft}
          onClick={() => aircraft && onRequestSell(aircraft.id)}
          className="flex-1 rounded-sm border border-ink-600 bg-ink-750 py-3 font-mono text-[12px] uppercase tracking-callsign text-muted hover:text-text-high disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sell aircraft
        </button>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="label">{title}</span>
        <span className="h-px flex-1 bg-ink-600" />
      </div>
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        {children}
      </div>
    </div>
  );
}
