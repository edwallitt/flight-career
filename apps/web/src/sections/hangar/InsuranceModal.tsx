import { useEffect, useState } from "react";
import {
  INSURANCE_TIERS,
  INSURANCE_TIER_ORDER,
  type EventSeverity,
  type InsuranceTier,
} from "@flightcareer/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { CornerTicks } from "../../components/CornerTicks.js";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

type QuotesResult = NonNullable<
  inferRouterOutputs<AppRouter>["insurance"]["quotes"]
>;
type Quote = QuotesResult["quotes"][number];
type CurrentPolicy = NonNullable<QuotesResult["currentPolicy"]>;

const SEVERITY_ORDER: EventSeverity[] = ["light", "moderate", "severe"];

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

// Two-tap confirm: first tap arms, second tap commits. Shared by the buy and
// cancel actions so the armed/commit wording and reset live in one place.
function useTwoTapConfirm(onConfirm: () => void) {
  const [confirming, setConfirming] = useState(false);
  return {
    confirming,
    reset: () => setConfirming(false),
    onPrimary: () => {
      if (!confirming) {
        setConfirming(true);
        return;
      }
      onConfirm();
    },
  };
}

function SeverityChips({ tier }: { tier: InsuranceTier }) {
  const covered = new Set(INSURANCE_TIERS[tier].coveredSeverities);
  return (
    <div className="flex gap-1.5">
      {SEVERITY_ORDER.map((s) => {
        const on = covered.has(s);
        return (
          <span
            key={s}
            className={[
              "rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign",
              on
                ? "border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-300"
                : "border-ink-600 bg-ink-850 text-muted-faint",
            ].join(" ")}
          >
            {s}
          </span>
        );
      })}
    </div>
  );
}

function premiumBreakdown(q: Quote): string {
  if (q.riskSurchargeBps <= 0) {
    return `${formatCash(q.monthlyPremiumCents)}/mo`;
  }
  const baseCents =
    Math.round((q.insuredValueCents * q.baseRateBps) / 10_000 / 100) * 100;
  const surchargeCents = Math.max(0, q.monthlyPremiumCents - baseCents);
  return `Base ${formatCash(baseCents)} + risk surcharge ${formatCash(surchargeCents)} = ${formatCash(q.monthlyPremiumCents)}/mo`;
}

function TierCard({
  quote,
  ownedAircraftId,
  hasActivePolicy,
  onDone,
}: {
  quote: Quote;
  ownedAircraftId: number;
  hasActivePolicy: boolean;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const buy = trpc.insurance.buy.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.hangar.fleet.invalidate();
        utils.hangar.aircraftById.invalidate();
        utils.career.get.invalidate();
        utils.insurance.quotes.invalidate({ ownedAircraftId });
        onDone();
      }
    },
  });

  const spec = INSURANCE_TIERS[quote.tier];
  const disabled = !quote.available || hasActivePolicy || buy.isPending;
  const { confirming, onPrimary } = useTwoTapConfirm(() =>
    buy.mutate({ ownedAircraftId, tier: quote.tier }),
  );

  const errorMsg =
    buy.data && !buy.data.ok ? buy.data.error : buy.error?.message ?? null;

  return (
    <div
      className={[
        "relative flex min-h-[420px] flex-col rounded-sm border bg-ink-800 p-5",
        quote.tier === "standard" ? "border-amber-deep/60" : "border-ink-600",
        !quote.available && "opacity-60",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mb-3">
        <div className="font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
          {spec.label}
        </div>
        <div className="mt-1 text-[11px] leading-snug text-muted">
          {spec.description}
        </div>
      </div>

      <div className="border-y border-ink-600 py-3">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
          <span className="label">Covers</span>
          <SeverityChips tier={quote.tier} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[11px]">
          <div>
            <div className="label">Deductible</div>
            <div className="tabular-nums text-text-high">
              {formatCash(quote.deductibleCents)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-faint">per claim</div>
          </div>
          <div className="text-right">
            <div className="label">Ceiling</div>
            <div className="tabular-nums text-text-high">
              {formatCash(quote.perClaimCeilingCents)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-faint">per claim</div>
          </div>
        </div>
      </div>

      <div className="border-b border-ink-600 py-3">
        <div className="label">Monthly premium</div>
        <div className="mt-1 font-mono text-[18px] tabular-nums text-amber-warm">
          {formatCash(quote.monthlyPremiumCents)}
          <span className="text-[11px] text-muted-dim">/mo</span>
        </div>
        {quote.riskSurchargeBps > 0 && (
          <div className="mt-1 font-mono text-[10px] text-urgency-urgent">
            {premiumBreakdown(quote)}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {!quote.available ? (
          <div className="rounded-sm border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-[10px] leading-snug text-muted">
            {quote.unavailableReason ?? "Unavailable for this aircraft"}
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={onPrimary}
              title={
                hasActivePolicy
                  ? "Cancel the current policy before changing tier"
                  : undefined
              }
              className={[
                "rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                confirming
                  ? "border-urgency-critical bg-urgency-critical/[0.08] text-urgency-critical hover:bg-urgency-critical/[0.16]"
                  : "border-amber-deep bg-amber-glow/[0.08] text-amber-glow hover:bg-amber-glow/[0.16] hover:text-amber-warm",
                "disabled:cursor-not-allowed disabled:opacity-40",
              ].join(" ")}
            >
              {buy.isPending
                ? "Buying…"
                : confirming
                  ? "Confirm — buy policy"
                  : "Buy policy"}
            </button>
            {confirming && !buy.isPending && (
              <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                First month ({formatCash(quote.monthlyPremiumCents)}) charged
                now
              </div>
            )}
          </>
        )}
        {errorMsg && (
          <div className="rounded-sm border border-urgency-critical/40 bg-urgency-critical/[0.05] px-2 py-1 font-mono text-[10px] text-urgency-critical">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivePolicyCard({
  policy,
  ownedAircraftId,
  onDone,
}: {
  policy: CurrentPolicy;
  ownedAircraftId: number;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const cancel = trpc.insurance.cancel.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.hangar.fleet.invalidate();
        utils.hangar.aircraftById.invalidate();
        utils.career.get.invalidate();
        utils.insurance.quotes.invalidate({ ownedAircraftId });
        onDone();
      }
    },
  });
  const { confirming, onPrimary } = useTwoTapConfirm(() =>
    cancel.mutate({ ownedAircraftId }),
  );

  const errorMsg =
    cancel.data && !cancel.data.ok
      ? cancel.data.error
      : cancel.error?.message ?? null;

  return (
    <div className="relative rounded-sm border border-emerald-500/40 bg-emerald-500/[0.04] p-6">
      <CornerTicks />
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-callsign text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Active policy · {policy.tierLabel}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-4">
        <div>
          <div className="label">Monthly premium</div>
          <div className="mt-0.5 font-mono text-[16px] tabular-nums text-amber-warm">
            {formatCash(policy.monthlyPremiumCents)}
          </div>
        </div>
        <div>
          <div className="label">Deductible</div>
          <div className="mt-0.5 font-mono text-[16px] tabular-nums text-text-high">
            {formatCash(policy.deductibleCents)}
          </div>
        </div>
        <div>
          <div className="label">Per-claim ceiling</div>
          <div className="mt-0.5 font-mono text-[16px] tabular-nums text-text-high">
            {formatCash(policy.perClaimCeilingCents)}
          </div>
        </div>
        <div>
          <div className="label">Insured value</div>
          <div className="mt-0.5 font-mono text-[16px] tabular-nums text-text-high">
            {formatCash(policy.insuredValueCents)}
          </div>
        </div>
        <div>
          <div className="label">Started</div>
          <div className="mt-0.5 font-mono text-[13px] tabular-nums text-muted">
            {formatSimDateTime(policy.startedAt)}
          </div>
        </div>
        <div>
          <div className="label">Next premium due</div>
          <div className="mt-0.5 font-mono text-[13px] tabular-nums text-muted">
            {formatSimDateTime(policy.nextPremiumDueAt)}
          </div>
        </div>
        <div>
          <div className="label">Premiums charged</div>
          <div className="mt-0.5 font-mono text-[13px] tabular-nums text-muted">
            {policy.paymentsMade}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={cancel.isPending}
          onClick={onPrimary}
          className={[
            "self-start rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-callsign transition-colors",
            confirming
              ? "border-urgency-critical bg-urgency-critical/[0.10] text-urgency-critical hover:bg-urgency-critical/[0.18]"
              : "border-ink-600 bg-ink-750 text-muted hover:border-urgency-critical/60 hover:text-urgency-critical",
            "disabled:cursor-not-allowed disabled:opacity-40",
          ].join(" ")}
        >
          {cancel.isPending
            ? "Cancelling…"
            : confirming
              ? "Confirm — cancel policy"
              : "Cancel policy"}
        </button>
        {confirming && !cancel.isPending && (
          <div className="font-mono text-[10px] uppercase tracking-callsign text-urgency-urgent">
            Cover ends immediately. No refund of the current month — the
            premium already paid is forfeit.
          </div>
        )}
        {errorMsg && (
          <div className="rounded-sm border border-urgency-critical/40 bg-urgency-critical/[0.05] px-2 py-1 font-mono text-[10px] text-urgency-critical">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

export function InsuranceModal({
  ownedAircraftId,
  onClose,
}: {
  ownedAircraftId: number;
  onClose: () => void;
}) {
  useBodyScrollLock();
  useEscape(onClose);

  // Quotes only move on buy/cancel (invalidated by those mutations) or slow
  // risk/time drift, so a long autonomous poll is enough.
  const quotesQuery = trpc.insurance.quotes.useQuery(
    { ownedAircraftId },
    { refetchInterval: 30_000 },
  );
  const data = quotesQuery.data;
  const policy = data?.currentPolicy ?? null;
  const aircraft = data?.aircraft ?? null;

  const orderedQuotes = data
    ? INSURANCE_TIER_ORDER.map(
        (t) => data.quotes.find((q) => q.tier === t)!,
      ).filter(Boolean)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 px-6 py-10">
      <div className="relative flex h-full max-h-[820px] w-full max-w-[1180px] flex-col overflow-hidden rounded-sm border border-ink-600 bg-ink-850 shadow-2xl">
        <CornerTicks />

        <div className="flex items-start justify-between border-b border-ink-600 bg-ink-800 px-8 pt-6 pb-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Hangar · Insurance
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
              {aircraft
                ? `Insurance: ${aircraft.tailNumber} · ${aircraft.model}`
                : "Insurance"}
            </h1>
            {aircraft && (
              <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                @ <span className="icao">{aircraft.currentLocationIcao}</span>{" "}
                {aircraft.locationName}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {aircraft && (
              <div className="text-right">
                <div className="label">Insured value</div>
                <div className="font-mono text-[16px] tabular-nums text-amber-warm">
                  {formatCash(aircraft.estimatedValueCents)}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-faint">
                  current market valuation
                </div>
              </div>
            )}
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
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {!data ? (
            <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              {quotesQuery.isPending ? "loading…" : "no aircraft"}
            </div>
          ) : policy ? (
            <div className="flex flex-col gap-6">
              <ActivePolicyCard
                policy={policy}
                ownedAircraftId={ownedAircraftId}
                onDone={onClose}
              />
              <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                Changing tier requires cancelling this policy first.
              </div>
              <div className="grid grid-cols-1 gap-5 opacity-50 lg:grid-cols-3">
                {orderedQuotes.map((q) => (
                  <TierCard
                    key={q.tier}
                    quote={q}
                    ownedAircraftId={ownedAircraftId}
                    hasActivePolicy
                    onDone={onClose}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {orderedQuotes.map((q) => (
                <TierCard
                  key={q.tier}
                  quote={q}
                  ownedAircraftId={ownedAircraftId}
                  hasActivePolicy={false}
                  onDone={onClose}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-ink-600 bg-ink-800 px-8 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-ink-600 bg-ink-750 px-5 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-muted hover:text-text-high"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
