import { useEffect, useState } from "react";
import { trpc } from "../../trpc.js";
import {
  formatCash,
  formatPay,
  formatSimDateTime,
  ROLE_LABEL,
} from "../../lib/formatters.js";

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

const STATE_LABEL: Record<string, string> = {
  accepted: "Accepted",
  briefed: "Briefed · Fueled",
  in_progress: "In flight",
};

const STATE_NARRATIVE: Record<string, string> = {
  accepted:
    "Job committed. Aircraft is locked. Brief the flight to fuel up and lock in your departure plan.",
  briefed:
    "Pre-flight complete. Fuel paid. Cleared to begin the flight when you're ready in the sim.",
  in_progress: "Flight underway in MSFS.",
};

function formatBlockTime(distanceNm: number, kts: number): string {
  if (kts <= 0) return "—";
  const minutes = Math.round((distanceNm / kts) * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
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

export function CurrentJobModal({
  onClose,
  onBeginBriefing,
}: {
  onClose: () => void;
  onBeginBriefing: () => void;
}) {
  const utils = trpc.useUtils();
  const active = trpc.lifecycle.getActiveJob.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const cancelMutation = trpc.lifecycle.cancel.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.lifecycle.getActiveJob.invalidate();
        utils.jobs.list.invalidate();
        utils.career.get.invalidate();
        onClose();
      }
    },
  });
  const [confirmCancel, setConfirmCancel] = useState(false);

  useBodyScrollLock();
  useEscape(() => {
    if (confirmCancel) {
      setConfirmCancel(false);
      return;
    }
    onClose();
  });

  const data = active.data;
  if (!data) {
    return null;
  }

  const j = data.job;
  const a = data.aircraft;
  const stateNarrative = STATE_NARRATIVE[data.state] ?? "";
  const stateLabel = STATE_LABEL[data.state] ?? data.state;

  // Server is the source of truth for the rep penalty; UI just reads it.
  const repHit = data.cancelPenalty;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Active job"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[88vh] w-[760px] max-w-[92vw] flex-col border border-ink-600 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CornerTicks />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 px-7 py-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Active job · #{String(j.id).padStart(5, "0")}
              <span className="ml-2 rounded-sm border border-amber-deep bg-amber-glow/[0.10] px-2 py-0.5 text-amber-glow">
                {stateLabel}
              </span>
            </div>
            <div className="font-display text-2xl font-semibold tracking-tight text-text-high">
              {ROLE_LABEL[j.role] ?? j.role} · {formatPay(j.pay)}
            </div>
            <div className="font-mono text-tiny text-muted">{stateNarrative}</div>
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
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-5">
          {/* Big route */}
          <div className="rounded-sm border border-ink-600 bg-ink-750 p-5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="label">From</span>
                <span className="icao text-[28px] font-medium leading-none text-text-high">
                  {j.originIcao}
                </span>
                <span className="mt-1 text-tiny text-muted-dim">
                  {j.originName}
                </span>
              </div>
              <div className="mx-4 flex flex-1 items-center justify-center">
                <div className="flex flex-1 flex-col items-center">
                  <svg
                    width="100%"
                    height="14"
                    viewBox="0 0 200 14"
                    preserveAspectRatio="none"
                    className="text-amber-deep"
                    aria-hidden
                  >
                    <line
                      x1="2"
                      y1="7"
                      x2="198"
                      y2="7"
                      stroke="currentColor"
                      strokeDasharray="3 4"
                    />
                    <circle cx="2" cy="7" r="2.5" fill="currentColor" />
                    <circle cx="198" cy="7" r="2.5" fill="currentColor" />
                  </svg>
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                    {Math.round(j.distanceNm)} nm · est{" "}
                    {formatBlockTime(j.distanceNm, a.cruiseSpeedKts)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="label">To</span>
                <span className="icao text-[28px] font-medium leading-none text-text-high">
                  {j.destinationIcao}
                </span>
                <span className="mt-1 text-tiny text-muted-dim text-right">
                  {j.destinationName}
                </span>
              </div>
            </div>
          </div>

          {/* Aircraft + payload */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <span className="label">Aircraft</span>
              <div className="mt-1 font-display text-[16px] font-medium text-text-high">
                {a.manufacturer} {a.model}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-tiny text-muted">
                <span className="rounded-sm border border-ink-500 px-1.5 text-text">
                  {a.cls}
                </span>
                <span>{a.source === "owned" ? a.tailNumber : "rental"}</span>
                <span>· {a.cruiseSpeedKts} kts</span>
                <span>· {a.fuelBurnGph} gph {a.fuelType.toUpperCase()}</span>
              </div>
            </div>
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <span className="label">Payload</span>
              <div className="mt-1 font-mono text-[15px] text-text-high">
                {j.payloadLbs.toLocaleString()} lb
                <span className="ml-2 text-muted">
                  · {j.payloadType}
                  {j.paxCount ? ` · ${j.paxCount} pax` : ""}
                </span>
              </div>
              {j.description && (
                <p className="mt-2 text-tiny leading-relaxed text-muted">
                  {j.description}
                </p>
              )}
            </div>
          </div>

          {/* Brief / fuel summary */}
          {data.state === "briefed" && (
            <div className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-4">
              <div className="flex items-center justify-between">
                <span className="label text-amber-glow/80">Fuel briefed</span>
                <span className="font-mono text-tiny text-muted-dim">
                  paid out · cash already deducted
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-2 font-mono text-text-high">
                <div className="flex flex-col">
                  <span className="label">Gallons</span>
                  <span className="mt-0.5 tabular-nums">
                    {(data.briefedFuelGallons ?? 0).toFixed(0)} gal
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="label">Price / gal</span>
                  <span className="mt-0.5 tabular-nums">
                    {formatCash(data.fuelPriceCentsPerGal)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="label">Fuel cost</span>
                  <span className="mt-0.5 tabular-nums text-amber-warm">
                    {formatCash(data.briefedFuelCostCents ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cancel confirmation */}
          {confirmCancel && (
            <div className="rounded-sm border border-urgency-critical/60 bg-urgency-critical/[0.06] p-4">
              <div className="flex items-center gap-2">
                <span className="label text-urgency-critical">
                  Confirm cancellation
                </span>
                <span className="h-px flex-1 bg-urgency-critical/30" />
              </div>
              <ul className="mt-2 list-disc pl-5 font-mono text-tiny text-text">
                <li>
                  Reputation: <span className="text-urgency-critical">{repHit.role}</span> in{" "}
                  {ROLE_LABEL[j.role]}
                  {j.clientId && (
                    <>
                      , <span className="text-urgency-critical">{repHit.client}</span> with this client
                    </>
                  )}
                </li>
                {data.state === "briefed" && (
                  <li>
                    Fuel cost{" "}
                    <span className="text-urgency-critical">
                      {formatCash(data.briefedFuelCostCents ?? 0)}
                    </span>{" "}
                    is non-refundable
                  </li>
                )}
                <li>Aircraft will be released back to available</li>
              </ul>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="rounded-sm border border-ink-600 bg-ink-800 px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
                >
                  Keep job
                </button>
                <button
                  type="button"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                  className="rounded-sm border border-urgency-critical/70 bg-urgency-critical/[0.12] px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-urgency-critical hover:bg-urgency-critical/[0.22] disabled:opacity-40"
                >
                  {cancelMutation.isPending ? "Cancelling…" : "Confirm cancel"}
                </button>
              </div>
            </div>
          )}

          {j.expiresAt && (
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-3 text-tiny text-muted-dim">
              Expires {formatSimDateTime(j.expiresAt)} sim time.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-600 bg-ink-800 px-7 py-4">
          <button
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => setConfirmCancel(true)}
            className="rounded-sm border border-ink-600 bg-ink-750 px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-urgency-critical/60 hover:text-urgency-critical"
          >
            Cancel job…
          </button>
          <div className="flex items-center gap-2">
            {data.state === "accepted" && (
              <button
                type="button"
                onClick={onBeginBriefing}
                className="rounded-sm border border-amber-deep bg-amber-glow/[0.08] px-5 py-2 font-mono text-[12px] uppercase tracking-callsign text-amber-glow hover:bg-amber-glow/[0.18] hover:text-amber-warm"
              >
                Begin briefing ▸
              </button>
            )}
            {data.state === "briefed" && (
              <button
                type="button"
                onClick={() => alert("Begin Flight — coming next")}
                className="rounded-sm border border-amber-glow bg-amber-glow/[0.16] px-5 py-2 font-mono text-[12px] uppercase tracking-callsign text-amber-warm hover:bg-amber-glow/[0.24]"
              >
                Begin flight ▸
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
