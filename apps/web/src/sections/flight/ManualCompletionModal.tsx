import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../trpc.js";

interface JobLite {
  id: number;
  originIcao: string;
  destinationIcao: string;
  destinationName: string;
  distanceNm: number;
}

interface AircraftLite {
  cruiseSpeedKts: number;
  fuelBurnGph: number;
}

interface SubmitInput {
  actualDestinationIcao: string;
  blockTimeMinutes: number;
  fuelBurnedGal?: number;
}

function useEscape(onClose: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function ManualCompletionModal({
  job,
  aircraft,
  elapsedMs,
  isPending,
  errorMessage,
  onClose,
  onSubmit,
}: {
  job: JobLite;
  aircraft: AircraftLite;
  elapsedMs: number;
  isPending: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (input: SubmitInput) => void;
}) {
  useEscape(onClose);

  // Cached for the session — airport list rarely changes.
  const icaoOptions = trpc.airports.icaoOptions.useQuery(undefined, {
    staleTime: Infinity,
  });

  // Default block time: prefer wall-clock elapsed if non-trivial, else
  // estimated block time from distance/speed. For show; user can override.
  const estimatedBlockMin = Math.max(
    1,
    Math.round((job.distanceNm / aircraft.cruiseSpeedKts) * 60),
  );
  const elapsedMin = Math.max(1, Math.round(elapsedMs / 60_000));
  const defaultBlockMin = elapsedMs > 60_000 ? elapsedMin : estimatedBlockMin;

  const [destInput, setDestInput] = useState(job.destinationIcao);
  const [blockMin, setBlockMin] = useState<string>(String(defaultBlockMin));
  const [fuelInput, setFuelInput] = useState<string>("");
  const seededRef = useRef(false);

  // Re-seed defaults if job changes (different ICAO).
  useEffect(() => {
    if (!seededRef.current) {
      setDestInput(job.destinationIcao);
      seededRef.current = true;
    }
  }, [job.destinationIcao]);

  const blockMinutes = Number(blockMin);
  const blockValid = Number.isFinite(blockMinutes) && blockMinutes > 0;
  const fuelParsed = Number(fuelInput);
  const fuelProvided = fuelInput.trim().length > 0;
  const fuelValid = !fuelProvided || (Number.isFinite(fuelParsed) && fuelParsed >= 0);
  const destValid = destInput.trim().length >= 3;

  const fuelEstimate = useMemo(() => {
    if (!blockValid) return 0;
    return Math.round(((blockMinutes / 60) * aircraft.fuelBurnGph) * 10) / 10;
  }, [blockValid, blockMinutes, aircraft.fuelBurnGph]);

  const isDiversion =
    destValid && destInput.trim().toUpperCase() !== job.destinationIcao;

  const canSubmit = blockValid && fuelValid && destValid && !isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      actualDestinationIcao: destInput.trim().toUpperCase(),
      blockTimeMinutes: blockMinutes,
      fuelBurnedGal: fuelProvided ? fuelParsed : undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Manual completion"
      onClick={onClose}
    >
      <div
        className="relative flex w-[640px] max-w-[94vw] flex-col border border-amber-deep bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 bg-ink-850 px-7 py-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Manual completion · #{String(job.id).padStart(5, "0")}
            </div>
            <div className="font-display text-xl font-semibold tracking-tight text-text-high">
              Log the flight
            </div>
            <div className="font-mono text-tiny text-muted-dim">
              MSFS isn't connected — enter what actually happened.
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
        <div className="flex flex-col gap-5 px-7 py-6">
          {/* Destination */}
          <div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="actual-dest"
                className="label"
              >
                Actual destination
              </label>
              <span className="h-px flex-1 bg-ink-600" />
              <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                Filed: <span className="text-text">{job.destinationIcao}</span>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="actual-dest"
                type="text"
                list="icao-options"
                autoComplete="off"
                value={destInput}
                onChange={(e) =>
                  setDestInput(e.target.value.toUpperCase().slice(0, 8))
                }
                aria-invalid={!destValid}
                className={[
                  "w-40 rounded-sm border bg-ink-850 px-3 py-2 text-center font-mono text-[20px] tracking-callsign text-text-high outline-none focus:border-amber-glow",
                  destValid ? "border-ink-600" : "border-urgency-critical/70",
                ].join(" ")}
              />
              <datalist id="icao-options">
                {(icaoOptions.data ?? []).map((a) => (
                  <option key={a.icao} value={a.icao}>
                    {a.name}
                  </option>
                ))}
              </datalist>
              {isDiversion ? (
                <span className="rounded-sm border border-urgency-urgent/60 bg-urgency-urgent/[0.10] px-2 py-1 font-mono text-[10px] uppercase tracking-callsign text-urgency-urgent">
                  Diversion · pay & rep affected
                </span>
              ) : (
                <span className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.06] px-2 py-1 font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
                  Filed destination
                </span>
              )}
            </div>
          </div>

          {/* Block time + fuel */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <label htmlFor="block-time" className="label">
                  Block time
                </label>
                <span className="h-px flex-1 bg-ink-600" />
                <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  est {estimatedBlockMin} min
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="block-time"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={blockMin}
                  onChange={(e) => setBlockMin(e.target.value)}
                  aria-invalid={!blockValid}
                  className={[
                    "w-28 rounded-sm border bg-ink-850 px-3 py-2 text-right font-mono text-[18px] tabular-nums text-text-high outline-none focus:border-amber-glow",
                    blockValid ? "border-ink-600" : "border-urgency-critical/70",
                  ].join(" ")}
                />
                <span className="font-mono text-tiny uppercase tracking-callsign text-muted-dim">
                  minutes
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <label htmlFor="fuel-burn" className="label">
                  Fuel burned
                </label>
                <span className="h-px flex-1 bg-ink-600" />
                <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  est {fuelEstimate} gal
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="fuel-burn"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder="auto"
                  value={fuelInput}
                  onChange={(e) => setFuelInput(e.target.value)}
                  aria-invalid={!fuelValid}
                  className={[
                    "w-28 rounded-sm border bg-ink-850 px-3 py-2 text-right font-mono text-[18px] tabular-nums text-text-high outline-none focus:border-amber-glow placeholder:text-muted-faint",
                    fuelValid ? "border-ink-600" : "border-urgency-critical/70",
                  ].join(" ")}
                />
                <span className="font-mono text-tiny uppercase tracking-callsign text-muted-dim">
                  gallons
                </span>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-sm border border-urgency-critical/60 bg-urgency-critical/[0.07] p-3 font-mono text-tiny text-urgency-critical">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-600 bg-ink-850 px-7 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-ink-600 bg-ink-750 px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            ← Back
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-sm border border-amber-glow bg-amber-glow/[0.16] px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-amber-warm shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_0_22px_-6px_rgba(212,165,116,0.55)] hover:bg-amber-glow/[0.24] disabled:opacity-40"
          >
            {isPending ? "Logging…" : "Submit flight ▸"}
          </button>
        </div>
      </div>
    </div>
  );
}
