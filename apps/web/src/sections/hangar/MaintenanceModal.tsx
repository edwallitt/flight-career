import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

type Options = NonNullable<
  inferRouterOutputs<AppRouter>["maintenance"]["options"]
>;
type Option = Options["options"][number];
type MaintenanceType = Option["type"];

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
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />
    </>
  );
}

function ProgressBar({
  value,
  isOverdue,
  isWarning,
}: {
  value: number;
  isOverdue?: boolean;
  isWarning?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color = isOverdue
    ? "bg-urgency-critical"
    : isWarning
      ? "bg-amber-glow"
      : "bg-emerald-400";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm border border-ink-600 bg-ink-850">
      <div className={`${color} h-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function statusValueDisplay(opt: Option): {
  text: string;
  bar: { value: number; isWarning: boolean; isOverdue: boolean };
} {
  const { current, threshold } = opt.counterStatus;
  const isOverdue = current >= threshold;
  const ratio = threshold > 0 ? current / threshold : 0;
  const isWarning = !isOverdue && ratio >= 0.85;

  let text: string;
  switch (opt.type) {
    case "100hr":
      text = `${current.toFixed(1)} / ${threshold} hrs`;
      break;
    case "annual":
      text = `${Math.round(current)} / ${threshold} days`;
      break;
    case "overhaul":
      text = `${Math.round(current).toLocaleString()} / ${threshold.toLocaleString()} hrs`;
      break;
  }
  return {
    text,
    bar: { value: Math.min(1, ratio), isOverdue, isWarning },
  };
}

function recommendedThresholdLabel(type: MaintenanceType): string {
  switch (type) {
    case "100hr":
      return "Recommended at 90+ hrs";
    case "annual":
      return "Recommended at 330+ days";
    case "overhaul":
      return "Recommended past 85% of TBO";
  }
}

function OptionCard({
  opt,
  ownedAircraftId,
  onBooked,
  disabledByInProgress,
  highlighted,
}: {
  opt: Option;
  ownedAircraftId: number;
  onBooked: () => void;
  disabledByInProgress: boolean;
  highlighted: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);
  const [confirming, setConfirming] = useState(false);
  const utils = trpc.useUtils();
  const book = trpc.maintenance.book.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.hangar.fleet.invalidate();
        utils.hangar.aircraftById.invalidate();
        utils.career.get.invalidate();
        utils.maintenance.options.invalidate({ ownedAircraftId });
        utils.logbook.maintenance.invalidate();
        onBooked();
      }
    },
  });

  const status = statusValueDisplay(opt);
  const isOverdue = (opt.counterStatus.daysOverdue ?? 0) > 0 || (opt.counterStatus.hoursOverdue ?? 0) > 0;
  const eligible = opt.eligibility.eligible && !disabledByInProgress;

  const eligibilityLine = (() => {
    if (disabledByInProgress) {
      return { text: "Aircraft currently in maintenance", tone: "muted" as const };
    }
    if (eligible) {
      return { text: "Available here", tone: "ok" as const };
    }
    return {
      text: opt.eligibility.reasons[0] ?? "Not eligible",
      tone: "bad" as const,
    };
  })();

  function onPrimary() {
    if (!eligible) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    book.mutate({ ownedAircraftId, type: opt.type });
  }

  const errorMsg =
    book.data && !book.data.ok ? book.data.error : book.error?.message ?? null;

  return (
    <div
      ref={cardRef}
      className={[
        "relative flex min-h-[360px] flex-col rounded-sm border bg-ink-800 p-5 transition-shadow",
        opt.recommended && !isOverdue
          ? "border-amber-deep/60"
          : "border-ink-600",
        highlighted &&
          "ring-2 ring-amber-glow/60 shadow-[0_0_24px_-6px_rgba(212,165,116,0.55)]",
        disabledByInProgress && "opacity-50",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isOverdue && (
        <span className="absolute right-3 top-3 rounded-sm border border-urgency-critical/60 bg-urgency-critical/[0.10] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-urgency-critical">
          Overdue
        </span>
      )}
      {!isOverdue && opt.recommended && (
        <span className="absolute right-3 top-3 rounded-sm border border-amber-deep/60 bg-amber-glow/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-amber-glow">
          Recommended
        </span>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
          {opt.spec.label}
        </div>
        <div className="mt-1 text-[11px] leading-snug text-muted">
          {opt.spec.description}
        </div>
      </div>

      {/* Status */}
      <div className="border-y border-ink-600 py-3">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
          <span className="label">Status</span>
          <span className="tabular-nums text-text-high">{status.text}</span>
        </div>
        <ProgressBar
          value={status.bar.value}
          isOverdue={status.bar.isOverdue}
          isWarning={status.bar.isWarning}
        />
        <div className="mt-2 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {recommendedThresholdLabel(opt.type)}
        </div>
      </div>

      {/* Cost + duration */}
      <div className="grid grid-cols-2 gap-3 border-b border-ink-600 py-3">
        <div>
          <div className="label">Cost</div>
          <div className="font-mono text-[18px] tabular-nums text-amber-warm">
            {formatCash(opt.estimate.baseCostCents)}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Duration</div>
          <div className="font-mono text-[18px] tabular-nums text-text-high">
            {opt.estimate.durationDays}{" "}
            <span className="text-[11px] text-muted-dim">
              sim day{opt.estimate.durationDays === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {/* Eligibility */}
      <div className="py-3">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              eligibilityLine.tone === "ok" && "bg-emerald-400",
              eligibilityLine.tone === "bad" && "bg-urgency-critical",
              eligibilityLine.tone === "muted" && "bg-muted-dim",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <span
            className={
              eligibilityLine.tone === "ok"
                ? "text-emerald-300"
                : eligibilityLine.tone === "bad"
                  ? "text-urgency-critical"
                  : "text-muted"
            }
          >
            {eligibilityLine.text}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        <button
          type="button"
          disabled={!eligible || book.isPending}
          onClick={onPrimary}
          className={[
            "rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-callsign transition-colors",
            confirming
              ? "border-urgency-critical bg-urgency-critical/[0.08] text-urgency-critical hover:bg-urgency-critical/[0.16]"
              : "border-amber-deep bg-amber-glow/[0.08] text-amber-glow hover:bg-amber-glow/[0.16] hover:text-amber-warm",
            "disabled:cursor-not-allowed disabled:opacity-40",
          ].join(" ")}
        >
          {book.isPending
            ? "Booking…"
            : confirming
              ? "Confirm booking"
              : "Book"}
        </button>
        {confirming && eligible && !book.isPending && (
          <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
            Cash deducts now · aircraft unavailable for {opt.estimate.durationDays} day{opt.estimate.durationDays === 1 ? "" : "s"}
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

function InProgressCard({
  inProgress,
  simNow,
}: {
  inProgress: NonNullable<Options["inProgress"]>;
  simNow: number;
}) {
  const remainingMs = Math.max(0, inProgress.scheduledCompletionAt - simNow);
  const remainingDays = Math.max(0, Math.ceil(remainingMs / SIM_DAY_MS));

  return (
    <div className="relative rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-6">
      <CornerTicks />
      <div className="font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
        In progress · {inProgress.label}
      </div>
      {inProgress.type === "unscheduled" && inProgress.description && (
        <div className="mt-1 font-mono text-tiny text-text">
          {inProgress.description}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <div className="label">Started</div>
          <div className="font-mono text-[14px] tabular-nums text-text-high">
            {formatSimDateTime(inProgress.startedAt)}
          </div>
          <div className="font-mono text-[11px] text-muted-dim">
            at <span className="icao">{inProgress.airportIcao}</span>{" "}
            {inProgress.airportName}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Expected completion</div>
          <div className="font-mono text-[14px] tabular-nums text-text-high">
            {formatSimDateTime(inProgress.scheduledCompletionAt)}
          </div>
          <div className="font-mono text-[11px] text-amber-glow">
            in {remainingDays} sim day{remainingDays === 1 ? "" : "s"}
          </div>
        </div>
        <div>
          <div className="label">Cost paid</div>
          <div className="font-mono text-[16px] tabular-nums text-amber-warm">
            {formatCash(inProgress.cost)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MaintenanceModal({
  ownedAircraftId,
  onClose,
  highlightType,
}: {
  ownedAircraftId: number;
  onClose: () => void;
  highlightType?: MaintenanceType;
}) {
  useBodyScrollLock();
  useEscape(onClose);

  const optionsQuery = trpc.maintenance.options.useQuery(
    { ownedAircraftId },
    { refetchInterval: 10_000 },
  );
  const career = trpc.career.get.useQuery();
  const data = optionsQuery.data;
  const cash = career.data?.cash ?? 0;
  const simNow = career.data?.simDateTime ?? Date.now();

  const inProgress = data?.inProgress ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 px-6 py-10">
      <div className="relative flex h-full max-h-[820px] w-full max-w-[1180px] flex-col overflow-hidden rounded-sm border border-ink-600 bg-ink-850 shadow-2xl">
        <CornerTicks />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 bg-ink-800 px-8 pt-6 pb-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Hangar · Maintenance
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
              {data
                ? `Maintenance: ${data.tailNumber} · ${data.model}`
                : "Maintenance"}
            </h1>
            {data && (
              <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                @ <span className="icao">{data.currentLocationIcao}</span>{" "}
                {data.airportName}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="label">Cash</div>
              <div className="font-mono text-[16px] tabular-nums text-text-high">
                {formatCash(cash)}
              </div>
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
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {!data ? (
            <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              {optionsQuery.isPending ? "loading…" : "no aircraft"}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {inProgress && (
                <InProgressCard inProgress={inProgress} simNow={simNow} />
              )}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {data.options.map((opt) => {
                  // Resolve highlight target: prefer the explicit prop, fall
                  // back to the first recommended option, fall back to the
                  // first overdue option. Null if nothing stands out.
                  const recommendedType =
                    highlightType ??
                    data.options.find((o) => o.recommended)?.type ??
                    null;
                  return (
                    <OptionCard
                      key={opt.type}
                      opt={opt}
                      ownedAircraftId={ownedAircraftId}
                      onBooked={onClose}
                      disabledByInProgress={!!inProgress}
                      highlighted={opt.type === recommendedType}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
