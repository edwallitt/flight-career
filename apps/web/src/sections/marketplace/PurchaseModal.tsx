import { useEffect, useMemo, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";

type PaymentMethod = "cash" | "loan";

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

function formatRateBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function MethodTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative flex-1 px-4 py-2 font-mono text-[12px] uppercase tracking-callsign transition-colors",
        active
          ? "text-text-high"
          : "text-muted-dim hover:text-text",
      ].join(" ")}
    >
      {active && (
        <span className="absolute inset-0 rounded-sm bg-amber-glow/[0.07] ring-1 ring-amber-deep/60" />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}

export function PurchaseModal({
  listingId,
  onClose,
}: {
  listingId: number;
  onClose: () => void;
}) {
  useBodyScrollLock();
  useEscape(onClose);

  const utils = trpc.useUtils();
  const preview = trpc.marketplace.previewPurchase.useQuery({ listingId });
  const career = trpc.career.get.useQuery();
  const purchase = trpc.marketplace.purchase.useMutation();

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [success, setSuccess] = useState<{
    tailNumber: string;
    loanId: number | null;
  } | null>(null);

  // Default the method based on what the player can afford.
  useEffect(() => {
    if (preview.data && preview.data.ok && method === "cash") {
      if (!preview.data.preview.cash.affordable) {
        const anyLoan = preview.data.preview.loans.find((l) => l.affordable);
        if (anyLoan) setMethod("loan");
      }
    }
  }, [preview.data, method]);

  // Default the loan term to the first affordable option.
  useEffect(() => {
    if (preview.data && preview.data.ok && method === "loan" && selectedTerm == null) {
      const first =
        preview.data.preview.loans.find((l) => l.affordable) ??
        preview.data.preview.loans[0];
      if (first) setSelectedTerm(first.termMonths);
    }
  }, [preview.data, method, selectedTerm]);

  // Auto-close 2 seconds after a successful purchase.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      onClose();
    }, 2000);
    return () => clearTimeout(t);
  }, [success, onClose]);

  const data = preview.data;
  const cash = career.data?.cash ?? 0;

  const selectedLoan = useMemo(() => {
    if (!data || !data.ok || selectedTerm == null) return null;
    return data.preview.loans.find((l) => l.termMonths === selectedTerm) ?? null;
  }, [data, selectedTerm]);

  const canConfirm = (() => {
    if (!data || !data.ok) return false;
    if (purchase.isPending) return false;
    if (method === "cash") return data.preview.cash.affordable;
    return selectedLoan != null && selectedLoan.affordable;
  })();

  const errorMsg = (() => {
    if (purchase.error) return purchase.error.message;
    if (purchase.data && !purchase.data.ok) return purchase.data.error;
    if (data && !data.ok) return data.error;
    return null;
  })();

  function onConfirm() {
    if (!canConfirm || !data || !data.ok) return;
    if (method === "cash") {
      purchase.mutate(
        { listingId, paymentMethod: "cash" },
        {
          onSuccess: (result) => {
            if (result.ok) {
              utils.career.get.invalidate();
              utils.marketplace.listings.invalidate();
              utils.marketplace.listingById.invalidate();
              setSuccess({ tailNumber: result.tailNumber, loanId: result.loanId });
            }
          },
        },
      );
    } else if (selectedLoan) {
      purchase.mutate(
        {
          listingId,
          paymentMethod: "loan",
          loanTermMonths: selectedLoan.termMonths,
        },
        {
          onSuccess: (result) => {
            if (result.ok) {
              utils.career.get.invalidate();
              utils.marketplace.listings.invalidate();
              utils.marketplace.listingById.invalidate();
              setSuccess({ tailNumber: result.tailNumber, loanId: result.loanId });
            }
          },
        },
      );
    }
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
              Marketplace · Purchase
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
              {data && data.ok
                ? `Purchase: ${data.preview.listing.aircraftTypeManufacturer} ${data.preview.listing.aircraftTypeModel}`
                : "Purchase aircraft"}
            </h1>
            {data && data.ok && (
              <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                Tail{" "}
                <span className="text-text-high">
                  {data.preview.listing.tailNumber}
                </span>{" "}
                · <span className="icao">{data.preview.listing.locationIcao}</span>
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
              {preview.isPending ? "loading…" : "no listing"}
            </div>
          ) : !data.ok ? (
            <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-urgency-critical">
              {data.error}
            </div>
          ) : success ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
                Purchase complete
              </div>
              <div className="font-display text-3xl font-semibold tracking-tight text-text-high">
                ✓ {success.tailNumber} is now yours
              </div>
              <div className="text-sm text-muted">
                {success.loanId
                  ? "Loan opened. First payment due in 30 days."
                  : "Cash purchase recorded."}
              </div>
            </div>
          ) : (
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
                      {data.preview.listing.aircraftClass}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Condition</div>
                    <div className="font-mono text-[12px] uppercase tracking-callsign text-text-high">
                      {data.preview.listing.conditionGrade}
                    </div>
                  </div>
                  <div>
                    <div className="label">Airframe hours</div>
                    <div className="font-mono text-[14px] tabular-nums text-text-high">
                      {Math.round(
                        data.preview.listing.airframeHours,
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Engine</div>
                    <div className="font-mono text-[14px] tabular-nums text-text-high">
                      {Math.round(
                        data.preview.listing.engineHoursSinceOverhaul,
                      ).toLocaleString()}{" "}
                      <span className="text-muted-dim">
                        / {data.preview.listing.tboHours.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="label">Last 100hr</div>
                    <div className="font-mono text-[14px] tabular-nums text-text-high">
                      {Math.round(
                        data.preview.listing.hoursSince100hr,
                      ).toLocaleString()}{" "}
                      hrs ago
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Last annual</div>
                    <div className="font-mono text-[14px] tabular-nums text-text-high">
                      {Math.round(
                        data.preview.listing.hoursSinceAnnual,
                      ).toLocaleString()}{" "}
                      days
                    </div>
                  </div>
                </div>

                {data.preview.listing.descriptionShort && (
                  <div className="border-l-2 border-amber-deep/70 pl-3">
                    <p className="text-[13px] italic leading-relaxed text-muted">
                      "{data.preview.listing.descriptionShort}"
                    </p>
                  </div>
                )}

                <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="label">Asking price</span>
                      <span className="font-mono text-[26px] tabular-nums text-amber-warm">
                        {formatCash(data.preview.cash.totalCents)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="label">vs new</span>
                      <span className="font-mono text-[12px] tabular-nums text-muted-dim line-through">
                        {formatCash(
                          data.preview.listing.basePurchasePriceCents,
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-sm border border-amber-deep/40 bg-amber-glow/[0.04] px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
                  After purchase, the aircraft remains at{" "}
                  <span className="icao">
                    {data.preview.listing.locationIcao}
                  </span>
                  . Use Travel to reposition it.
                </div>
              </div>

              {/* Right — payment method */}
              <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-8 py-6">
                <div className="flex items-center gap-2">
                  <span className="label">Payment</span>
                  <span className="h-px flex-1 bg-ink-600" />
                </div>

                <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
                  <MethodTab
                    label="Cash"
                    active={method === "cash"}
                    onClick={() => setMethod("cash")}
                  />
                  <MethodTab
                    label="Finance"
                    active={method === "loan"}
                    onClick={() => setMethod("loan")}
                  />
                </div>

                {method === "cash" ? (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-sm border border-ink-600 bg-ink-750 p-5">
                      <div className="label">Total today</div>
                      <div className="mt-1 font-mono text-[32px] tabular-nums text-amber-warm">
                        {formatCash(data.preview.cash.totalCents)}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div>
                          <div className="label">Your cash</div>
                          <div className="font-mono text-[16px] tabular-nums text-text-high">
                            {formatCash(cash)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="label">After purchase</div>
                          <div
                            className={[
                              "font-mono text-[16px] tabular-nums",
                              data.preview.cash.affordable
                                ? "text-emerald-300"
                                : "text-urgency-critical",
                            ].join(" ")}
                          >
                            {formatCash(data.preview.cash.cashAfterCents)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {!data.preview.cash.affordable && (
                      <div className="rounded-sm border border-urgency-critical/40 bg-urgency-critical/[0.06] px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-urgency-critical">
                        Insufficient cash. Switch to Finance, or browse cheaper
                        aircraft.
                      </div>
                    )}

                    <div className="rounded-sm border border-ink-600 bg-ink-800/60 px-3 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                      Monthly hangarage + insurance applies per aircraft type
                      and will be deducted automatically.
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {data.preview.loans.map((loan) => {
                        const sel = selectedTerm === loan.termMonths;
                        return (
                          <button
                            key={loan.termMonths}
                            type="button"
                            onClick={() => setSelectedTerm(loan.termMonths)}
                            className={[
                              "relative flex flex-col gap-2 rounded-sm border bg-ink-750 p-4 text-left transition-colors",
                              sel
                                ? "border-amber-deep bg-amber-glow/[0.06]"
                                : "border-ink-600 hover:border-amber-deep/60",
                              !loan.affordable && "opacity-60",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <div className="flex items-baseline justify-between">
                              <span className="font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
                                {loan.termMonths} months
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-dim">
                                {formatRateBps(loan.interestRateBps)}
                              </span>
                            </div>
                            <div>
                              <div className="label">Down payment</div>
                              <div className="font-mono text-[15px] tabular-nums text-text-high">
                                {formatCash(loan.downPaymentCents)}
                              </div>
                            </div>
                            <div>
                              <div className="label">Monthly</div>
                              <div className="font-mono text-[18px] tabular-nums text-amber-warm">
                                {formatCash(loan.monthlyPaymentCents)}
                                <span className="ml-1 text-[10px] text-muted-dim">
                                  / mo
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-t border-ink-600 pt-2">
                              <div>
                                <div className="label">Interest</div>
                                <div className="font-mono text-[12px] tabular-nums text-muted">
                                  {formatCash(loan.totalInterestCents)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="label">Total paid</div>
                                <div className="font-mono text-[12px] tabular-nums text-text-high">
                                  {formatCash(
                                    loan.totalPaidCents + loan.downPaymentCents,
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign">
                              <span
                                className={[
                                  "h-1.5 w-1.5 rounded-full",
                                  loan.affordable
                                    ? "bg-emerald-400"
                                    : "bg-urgency-critical",
                                ].join(" ")}
                              />
                              <span
                                className={
                                  loan.affordable
                                    ? "text-emerald-300"
                                    : "text-urgency-critical"
                                }
                              >
                                {loan.affordable
                                  ? "Down payment OK"
                                  : "Down payment short"}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedLoan && (
                      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="label">Down payment now</div>
                            <div className="font-mono text-[18px] tabular-nums text-amber-warm">
                              {formatCash(selectedLoan.downPaymentCents)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="label">After down payment</div>
                            <div
                              className={[
                                "font-mono text-[18px] tabular-nums",
                                cash >= selectedLoan.downPaymentCents
                                  ? "text-emerald-300"
                                  : "text-urgency-critical",
                              ].join(" ")}
                            >
                              {formatCash(cash - selectedLoan.downPaymentCents)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 border-t border-ink-600 pt-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                          First payment due in 30 days ·{" "}
                          <span className="text-amber-glow">
                            {formatCash(selectedLoan.monthlyPaymentCents)} / mo
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-ink-600 bg-ink-800 px-8 py-4">
          <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
            {errorMsg ? (
              <span className="text-urgency-critical">{errorMsg}</span>
            ) : success ? (
              "Closing…"
            ) : method === "cash" ? (
              "Pays the asking price in full from operating capital."
            ) : selectedLoan ? (
              `${selectedLoan.termMonths}-month note · auto-debit each sim month.`
            ) : (
              "Select a financing option to continue."
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
              disabled={!canConfirm || !!success}
              onClick={onConfirm}
              className="group relative overflow-hidden rounded-sm border border-amber-deep bg-amber-glow/[0.08] px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:opacity-40"
            >
              {purchase.isPending ? "Processing…" : "Confirm purchase"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
