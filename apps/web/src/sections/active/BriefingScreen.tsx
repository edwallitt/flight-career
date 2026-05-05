import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";

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

function ChecklistRow({ label, met }: { label: string; met: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-ink-700 py-2 last:border-b-0">
      <span className="font-mono text-tiny text-text">{label}</span>
      <span
        className={[
          "flex items-center gap-1 font-mono text-[11px] uppercase tracking-callsign",
          met ? "text-amber-glow" : "text-urgency-critical",
        ].join(" ")}
      >
        {met ? "✓ go" : "✗ fail"}
      </span>
    </li>
  );
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

export function BriefingScreen({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const active = trpc.lifecycle.getActiveJob.useQuery();
  const career = trpc.career.get.useQuery();
  const briefMutation = trpc.lifecycle.brief.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.lifecycle.getActiveJob.invalidate();
        utils.career.get.invalidate();
        onClose();
      }
    },
  });

  // Track the input as a string so we can render exactly what the user typed
  // (including transient empty / non-numeric states) and parse defensively
  // before any computation. A bare `Number(value)` produces NaN for "" and
  // any non-numeric input, which slips past `<= 0` checks.
  const [fuelInput, setFuelInput] = useState<string>("");
  const seededRef = useRef(false);

  useBodyScrollLock();
  useEscape(onClose);

  // Seed the input from the server recommendation once.
  useEffect(() => {
    if (!seededRef.current && active.data) {
      setFuelInput(String(active.data.recommendedFuelGallons));
      seededRef.current = true;
    }
  }, [active.data]);

  const data = active.data;
  if (!data || data.state !== "accepted") {
    return null;
  }

  const j = data.job;
  const a = data.aircraft;

  const parsedFuel = Number(fuelInput);
  const fuelValid = Number.isFinite(parsedFuel) && parsedFuel > 0;
  const fuel = fuelValid ? parsedFuel : 0;
  const fuelCost = fuelValid ? Math.round(fuel * data.fuelPriceCentsPerGal) : 0;
  const cash = career.data?.cash ?? 0;
  const projectedCash = cash - fuelCost;
  const sufficient = projectedCash >= 0;
  const ratedOk = true; // accept already enforced this; informational only
  const atOrigin = a.currentLocationIcao === j.originIcao;
  const within = a.maxPayloadLbs >= j.payloadLbs;

  const errorMsg =
    briefMutation.data && !briefMutation.data.ok
      ? briefMutation.data.error
      : briefMutation.error
        ? briefMutation.error.message
        : null;

  const blockMinutes = Math.round((j.distanceNm / a.cruiseSpeedKts) * 60);
  const blockHours = Math.floor(blockMinutes / 60);
  const blockMins = blockMinutes % 60;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-ink-900/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pre-flight brief"
      onClick={onClose}
    >
      <div
        className="relative m-auto flex max-h-[94vh] w-[1080px] max-w-[96vw] flex-col border border-ink-600 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CornerTicks />

        {/* Header strap */}
        <div className="flex items-center justify-between border-b border-ink-600 bg-ink-850 px-8 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Pre-flight brief · #{String(j.id).padStart(5, "0")}
            </div>
            <div className="font-display text-xl font-semibold tracking-tight text-text-high">
              Final operational brief
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            ← Back to job
          </button>
        </div>

        {/* Big route */}
        <div className="border-b border-ink-600 bg-ink-850 px-8 py-7">
          <div className="flex items-center justify-center gap-10">
            <div className="flex flex-col items-end">
              <span className="label">Origin</span>
              <span className="icao text-[44px] font-medium leading-none text-text-high">
                {j.originIcao}
              </span>
              <span className="mt-1 text-tiny text-muted">{j.originName}</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
                {Math.round(j.distanceNm)} nm
              </span>
              <svg
                width="240"
                height="14"
                viewBox="0 0 240 14"
                className="text-amber-deep"
                aria-hidden
              >
                <line
                  x1="2"
                  y1="7"
                  x2="238"
                  y2="7"
                  stroke="currentColor"
                  strokeDasharray="3 4"
                />
                <circle cx="2" cy="7" r="2.5" fill="currentColor" />
                <circle cx="238" cy="7" r="2.5" fill="currentColor" />
              </svg>
              <span className="font-mono text-tiny uppercase tracking-callsign text-muted-dim">
                est block {blockHours}h {blockMins.toString().padStart(2, "0")}m · {a.cruiseSpeedKts} kts
              </span>
            </div>

            <div className="flex flex-col items-start">
              <span className="label">Destination</span>
              <span className="icao text-[44px] font-medium leading-none text-text-high">
                {j.destinationIcao}
              </span>
              <span className="mt-1 text-tiny text-muted">{j.destinationName}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center">
            <div className="flex items-center gap-3 rounded-sm border border-ink-600 bg-ink-750 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                SimBrief route
              </span>
              <span className="icao text-[14px] tracking-callsign text-text-high">
                {j.originIcao} {j.destinationIcao}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${j.originIcao} ${j.destinationIcao}`);
                }}
                className="rounded-sm border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
              >
                copy
              </button>
            </div>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-0 overflow-hidden">
          {/* Left: aircraft + fuel input */}
          <div className="flex flex-col gap-5 overflow-y-auto border-r border-ink-600 px-7 py-6">
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <span className="label">Aircraft</span>
              <div className="mt-1 font-display text-[18px] font-medium text-text-high">
                {a.manufacturer} {a.model}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-tiny text-muted">
                <span className="rounded-sm border border-ink-500 px-1.5 text-text">
                  {a.cls}
                </span>
                <span>{a.source === "owned" ? a.tailNumber : "rental"}</span>
                <span>· @ {a.currentLocationIcao}</span>
                <span>· {a.fuelBurnGph} gph {a.fuelType.toUpperCase()}</span>
              </div>
            </div>

            <div className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="label text-amber-glow/80">Fuel uplift</span>
                <span className="h-px flex-1 bg-amber-deep/40" />
                <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  reco {data.recommendedFuelGallons} gal
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-3">
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={1}
                  value={fuelInput}
                  onChange={(e) => setFuelInput(e.target.value)}
                  aria-invalid={!fuelValid}
                  className={[
                    "w-32 rounded-sm border bg-ink-800 px-3 py-2 text-right font-mono text-[20px] tabular-nums text-text-high outline-none focus:border-amber-glow",
                    fuelValid ? "border-ink-600" : "border-urgency-critical/70",
                  ].join(" ")}
                />
                <span className="font-mono text-tiny uppercase tracking-callsign text-muted-dim">
                  gallons
                </span>
                <span className="ml-auto font-mono text-tiny text-muted-dim">
                  × {formatCash(data.fuelPriceCentsPerGal)} / gal
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-amber-deep/30 pt-3">
                <span className="font-mono text-tiny uppercase tracking-callsign text-muted">
                  Fuel cost
                </span>
                <span className="font-mono text-[18px] tabular-nums text-amber-warm">
                  {formatCash(fuelCost)}
                </span>
              </div>
            </div>

            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center gap-2">
                <span className="label">Cash impact</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-text">
                <div className="flex flex-col">
                  <span className="label">Now</span>
                  <span className="mt-0.5 tabular-nums">{formatCash(cash)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="label">Fuel</span>
                  <span className="mt-0.5 tabular-nums text-urgency-urgent">
                    − {formatCash(fuelCost)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="label">After</span>
                  <span
                    className={[
                      "mt-0.5 tabular-nums",
                      sufficient ? "text-text-high" : "text-urgency-critical",
                    ].join(" ")}
                  >
                    {formatCash(projectedCash)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: checklist */}
          <div className="flex flex-col gap-5 overflow-y-auto px-7 py-6">
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center gap-2">
                <span className="label">Pre-flight checklist</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <ul className="mt-2">
                <ChecklistRow label="Aircraft at origin" met={atOrigin} />
                <ChecklistRow label="Rated for class" met={ratedOk} />
                <ChecklistRow
                  label="Sufficient cash for fuel"
                  met={sufficient}
                />
                <ChecklistRow label="Within MTOW estimation" met={within} />
              </ul>
            </div>

            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4 text-tiny leading-relaxed text-muted">
              Once you confirm, fuel cost is deducted and the flight is locked
              in as <span className="text-amber-glow">briefed</span>. Cancelling
              after this point won't refund the fuel.
            </div>

            {errorMsg && (
              <div className="rounded-sm border border-urgency-critical/60 bg-urgency-critical/[0.07] p-3 font-mono text-tiny text-urgency-critical">
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-600 bg-ink-850 px-8 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-ink-600 bg-ink-750 px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            ← Back to job
          </button>
          <button
            type="button"
            disabled={!sufficient || !fuelValid || briefMutation.isPending}
            onClick={() => briefMutation.mutate({ fuelGallons: fuel })}
            className="group relative rounded-sm border border-amber-glow bg-amber-glow/[0.14] px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-amber-warm shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_0_22px_-6px_rgba(212,165,116,0.55)] hover:bg-amber-glow/[0.22] disabled:opacity-40"
          >
            {briefMutation.isPending
              ? "Confirming…"
              : `Confirm brief & pay ${formatCash(fuelCost)}`}
            <span className="ml-2 text-amber-deep">▸</span>
          </button>
        </div>
      </div>
    </div>
  );
}
