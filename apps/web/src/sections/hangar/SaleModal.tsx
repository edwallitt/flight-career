import { useEffect, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

type SalePreviewData = inferRouterOutputs<AppRouter>["sale"]["preview"];
type SalePreviewOk = Extract<SalePreviewData, { ok: true }>;

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

function useEscape(onClose: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function useBodyScrollLock(): void {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

function CornerTicks() {
  return (
    <>
      <span className="pointer-events-none absolute left-4 top-4 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-4 top-4 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-4 bottom-4 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-4 bottom-4 block h-2 w-2 border-r border-b border-amber-deep/70" />
    </>
  );
}

export function SaleModal({
  ownedAircraftId,
  onClose,
  onSold,
}: {
  ownedAircraftId: number;
  onClose: () => void;
  onSold: (result: {
    tailNumber: string;
    saleProceedsCents: number;
    netReceivedCents: number;
  }) => void;
}) {
  useBodyScrollLock();
  useEscape(onClose);

  const utils = trpc.useUtils();
  const previewQuery = trpc.sale.preview.useQuery(
    { ownedAircraftId },
    { refetchInterval: 15_000 },
  );
  const career = trpc.career.get.useQuery();
  const confirm = trpc.sale.confirm.useMutation();
  const [confirming, setConfirming] = useState(false);

  const data = previewQuery.data;
  const cash = career.data?.cash ?? 0;
  const simNow = career.data?.simDateTime ?? Date.now();

  const errorMsg = (() => {
    if (confirm.error) return confirm.error.message;
    if (confirm.data && !confirm.data.ok) return confirm.data.error;
    if (data && !data.ok) return data.error;
    return null;
  })();

  function onPrimary() {
    if (!data || !data.ok || !data.preview.eligibility.eligible) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    confirm.mutate(
      { ownedAircraftId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            utils.career.get.invalidate();
            utils.hangar.fleet.invalidate();
            utils.hangar.aircraftById.invalidate();
            utils.sale.pastAircraft.invalidate();
            utils.logbook.financialSummary.invalidate();
            utils.atlas.getData.invalidate();
            onSold({
              tailNumber: data.preview.aircraft.tailNumber,
              saleProceedsCents: result.saleProceedsCents,
              netReceivedCents: result.netReceivedCents,
            });
          }
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 px-6 py-10">
      <div className="relative flex h-full max-h-[820px] w-full max-w-[1080px] flex-col overflow-hidden rounded-sm border border-ink-600 bg-ink-850 shadow-2xl">
        <CornerTicks />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 bg-ink-800 px-8 pt-6 pb-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Hangar · Sell
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
              {data && data.ok
                ? `Sell: ${data.preview.aircraft.manufacturer} ${data.preview.aircraft.model}`
                : "Sell aircraft"}
            </h1>
            {data && data.ok && (
              <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                Tail{" "}
                <span className="text-text-high">
                  {data.preview.aircraft.tailNumber}
                </span>{" "}
                · @{" "}
                <span className="icao">
                  {data.preview.aircraft.currentLocationIcao}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
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
        <div className="flex min-h-0 flex-1 flex-col">
          {!data ? (
            <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              {previewQuery.isPending ? "loading…" : "no aircraft"}
            </div>
          ) : !data.ok ? (
            <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-urgency-critical">
              {data.error}
            </div>
          ) : (
            <SaleBody
              aircraft={data.preview.aircraft}
              estimate={data.preview.estimate}
              eligibility={data.preview.eligibility}
              cash={cash}
              simNow={simNow}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-ink-600 bg-ink-800 px-8 py-4">
          <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
            {errorMsg ? (
              <span className="text-urgency-critical">{errorMsg}</span>
            ) : data && data.ok && data.preview.estimate.underwater ? (
              "Underwater sale — bring cash to closing. Action cannot be undone."
            ) : (
              "Proceeds settle immediately. Action cannot be undone."
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-ink-600 bg-ink-750 px-5 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-muted hover:text-text-high"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                !data ||
                !data.ok ||
                !data.preview.eligibility.eligible ||
                confirm.isPending
              }
              onClick={onPrimary}
              className={[
                "rounded-sm border px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                confirming
                  ? "border-urgency-critical bg-urgency-critical/[0.10] text-urgency-critical hover:bg-urgency-critical/[0.18]"
                  : "border-amber-deep bg-amber-glow/[0.08] text-amber-glow hover:bg-amber-glow/[0.16] hover:text-amber-warm",
              ].join(" ")}
            >
              {confirm.isPending
                ? "Processing…"
                : confirming
                  ? "Are you sure?"
                  : "Confirm sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaleBody({
  aircraft,
  estimate,
  eligibility,
  cash,
  simNow,
}: {
  aircraft: SalePreviewOk["preview"]["aircraft"];
  estimate: SalePreviewOk["preview"]["estimate"];
  eligibility: SalePreviewOk["preview"]["eligibility"];
  cash: number;
  simNow: number;
}) {
  const holdDays = Math.max(
    0,
    Math.floor((simNow - aircraft.purchasedAt) / SIM_DAY_MS),
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_minmax(420px,1.4fr)] gap-0">
      {/* Left — aircraft summary */}
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-ink-600 bg-ink-800/40 px-8 py-6">
        <div className="flex items-center gap-2">
          <span className="label">Aircraft</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-sm border border-ink-600 bg-ink-750 p-4">
          <div>
            <div className="label">Class</div>
            <div className="font-mono text-[14px] text-amber-glow">
              {aircraft.aircraftClass}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Condition (assumed)</div>
            <div className="font-mono text-[12px] uppercase tracking-callsign text-text-high">
              good
            </div>
          </div>
          <div>
            <div className="label">Airframe hours</div>
            <div className="font-mono text-[14px] tabular-nums text-text-high">
              {Math.round(aircraft.airframeHours).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Engine</div>
            <div className="font-mono text-[14px] tabular-nums text-text-high">
              {Math.round(aircraft.engineHoursSinceOverhaul).toLocaleString()}{" "}
              <span className="text-muted-dim">
                / {aircraft.tboHours.toLocaleString()}
              </span>
            </div>
          </div>
          <div>
            <div className="label">Last 100hr</div>
            <div className="font-mono text-[14px] tabular-nums text-text-high">
              {Math.round(aircraft.hoursSince100hr).toLocaleString()} hrs ago
            </div>
          </div>
          <div className="text-right">
            <div className="label">Last annual</div>
            <div className="font-mono text-[14px] tabular-nums text-text-high">
              {Math.round(aircraft.hoursSinceAnnual).toLocaleString()} days
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="label">Estimated value</span>
              <span className="font-mono text-[26px] tabular-nums text-amber-warm">
                {formatCash(estimate.estimatedValueCents)}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="label">Purchased</span>
              <span className="font-mono text-[12px] tabular-nums text-text-high">
                {formatCash(aircraft.purchasePriceCents)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                {holdDays} sim {holdDays === 1 ? "day" : "days"} ago
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-amber-deep/40 bg-amber-glow/[0.04] px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
          After sale, the aircraft is gone. Proceeds — or required cash —
          settle immediately.
        </div>
      </div>

      {/* Right — sale terms */}
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-8 py-6">
        <div className="flex items-center gap-2">
          <span className="label">Sale terms</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>

        {!eligibility.eligible ? (
          <div className="flex flex-col gap-3">
            {eligibility.reasons.map((r, i) => (
              <div
                key={i}
                className="rounded-sm border border-urgency-critical/50 bg-urgency-critical/[0.08] px-4 py-3 font-mono text-[12px] text-urgency-critical"
              >
                {r}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-5">
              <TermLine
                label="Estimated value"
                value={formatCash(estimate.estimatedValueCents)}
              />
              <TermLine
                label={`Broker spread (${(estimate.brokerSpreadBps / 100).toFixed(0)}%)`}
                value={`−${formatCash(estimate.brokerSpreadCents)}`}
                muted
              />
              <div className="my-2 h-px bg-ink-600" />
              <TermLine
                label="Sale proceeds"
                value={formatCash(estimate.grossSaleCents)}
                emphasis
              />
              <TermLine
                label="Loan payoff"
                value={
                  estimate.loanPayoffCents > 0
                    ? `−${formatCash(estimate.loanPayoffCents)}`
                    : "—"
                }
                muted
              />
              <div className="my-2 h-px bg-ink-600" />
              {estimate.underwater ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[12px] uppercase tracking-callsign text-urgency-critical">
                      Shortfall — you pay
                    </span>
                    <span className="font-mono text-[26px] tabular-nums text-urgency-critical">
                      −{formatCash(Math.abs(estimate.netToPlayerCents))}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                    After sale:{" "}
                    <span className="text-text-high">
                      {formatCash(cash + estimate.netToPlayerCents)}
                    </span>{" "}
                    cash
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[12px] uppercase tracking-callsign text-emerald-300">
                      Net to you
                    </span>
                    <span className="font-mono text-[26px] tabular-nums text-emerald-300">
                      +{formatCash(estimate.netToPlayerCents)}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                    After sale:{" "}
                    <span className="text-text-high">
                      {formatCash(cash + estimate.netToPlayerCents)}
                    </span>{" "}
                    cash
                  </div>
                </>
              )}
            </div>

            {estimate.underwater && (
              <div className="rounded-sm border border-urgency-critical/50 bg-urgency-critical/[0.06] px-4 py-3 font-mono text-[11px] uppercase tracking-callsign text-urgency-critical">
                Warning: this sale puts you underwater. Required from you{" "}
                <span className="font-display text-[14px]">
                  {formatCash(Math.abs(estimate.netToPlayerCents))}
                </span>
              </div>
            )}

            <div className="rounded-sm border border-ink-600 bg-ink-800/60 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
              Closing at{" "}
              <span className="icao">{aircraft.currentLocationIcao}</span> ·{" "}
              {formatSimDateTime(simNow)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TermLine({
  label,
  value,
  muted,
  emphasis,
}: {
  label: string;
  value: string;
  muted?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span
        className={[
          "font-mono text-[11px] uppercase tracking-callsign",
          muted ? "text-muted-dim" : "text-muted",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "font-mono tabular-nums",
          emphasis ? "text-[18px] text-amber-warm" : "text-[14px] text-text-high",
          muted && !emphasis ? "text-muted" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
