import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import { type RiskTier } from "@flightcareer/shared";

type RiskInfo = {
  tier: RiskTier;
  factors: Array<{ description: string; severity: string }>;
  cannotDispatch: boolean;
  cannotDispatchReason: string | null;
};

const RISK_TONE: Record<
  RiskTier,
  { label: string; tone: string; icon: string; bold: boolean }
> = {
  healthy: {
    label: "Aircraft healthy",
    tone: "text-amber-glow",
    icon: "✓",
    bold: false,
  },
  monitor: {
    label: "Monitor maintenance",
    tone: "text-amber-warm",
    icon: "⚠",
    bold: false,
  },
  elevated: {
    label: "Elevated risk",
    tone: "text-urgency-urgent",
    icon: "⚠",
    bold: false,
  },
  high: {
    label: "High risk",
    tone: "text-urgency-critical",
    icon: "⚠",
    bold: false,
  },
  critical: {
    label: "Critical risk",
    tone: "text-urgency-critical",
    icon: "⚠",
    bold: true,
  },
};

function AircraftStatusPanel({
  source,
  risk,
}: {
  source: "owned" | "rental" | "ferry";
  risk: RiskInfo | null;
}) {
  if (source === "rental") {
    return (
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Aircraft status</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-2 font-mono text-[12px] text-amber-glow">
          ✓ Rental — no maintenance risk to you
        </div>
      </div>
    );
  }

  if (source === "ferry") {
    return (
      <div className="rounded-sm border border-sky-500/40 bg-sky-500/[0.05] p-4">
        <div className="flex items-center gap-2">
          <span className="label text-sky-300/80">Ferry contract</span>
          <span className="h-px flex-1 bg-sky-500/20" />
        </div>
        <div className="mt-2 font-mono text-[12px] text-sky-300">
          ✓ Owner covers fuel, fees, and maintenance
        </div>
        <div className="mt-1 font-mono text-tiny text-muted">
          Block hours count toward your rating; no aircraft state changes for you.
        </div>
      </div>
    );
  }

  if (!risk) return null;

  if (risk.cannotDispatch) {
    return (
      <div className="rounded-sm border border-urgency-critical/70 bg-urgency-critical/[0.10] p-4">
        <div className="flex items-center gap-2">
          <span className="label text-urgency-critical">Aircraft status</span>
          <span className="h-px flex-1 bg-urgency-critical/40" />
        </div>
        <div className="mt-2 font-mono text-[12px] font-semibold text-urgency-critical">
          ✗ Cannot dispatch
        </div>
        {risk.cannotDispatchReason && (
          <div className="mt-1 font-mono text-tiny text-urgency-critical/80">
            {risk.cannotDispatchReason}
          </div>
        )}
      </div>
    );
  }

  const cfg = RISK_TONE[risk.tier];
  const factorSummary = risk.factors.map((f) => f.description).join("; ");

  return (
    <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
      <div className="flex items-center gap-2">
        <span className="label">Aircraft status</span>
        <span className="h-px flex-1 bg-ink-600" />
      </div>
      <div
        className={[
          "mt-2 font-mono text-[12px]",
          cfg.tone,
          cfg.bold ? "font-semibold" : "",
        ].join(" ")}
      >
        {cfg.icon} {cfg.label}
      </div>
      {factorSummary && (
        <div className="mt-1 font-mono text-tiny text-muted">
          {factorSummary}
        </div>
      )}
    </div>
  );
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

function fmtGal(gal: number): string {
  return Math.round(gal).toLocaleString("en-US");
}

function fmtNm(nm: number): string {
  return Math.round(nm).toLocaleString("en-US");
}

function FuelBar({
  ratio,
  tone,
}: {
  ratio: number;
  tone: "ok" | "warn" | "bad";
}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const colorClass =
    tone === "bad"
      ? "bg-urgency-critical"
      : tone === "warn"
        ? "bg-amber-warm"
        : "bg-amber-glow";
  return (
    <div className="h-1.5 w-full rounded-sm bg-ink-700">
      <div
        className={`h-full rounded-sm ${colorClass} transition-[width]`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RentalFuelPanel({
  rangeNm,
  cruiseSpeedKts,
  tripDistanceNm,
}: {
  rangeNm: number;
  cruiseSpeedKts: number;
  tripDistanceNm: number;
}) {
  const tripHours = cruiseSpeedKts > 0 ? tripDistanceNm / cruiseSpeedKts : 0;
  return (
    <div className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-4">
      <div className="flex items-center gap-2">
        <span className="label text-amber-glow/80">Fuel</span>
        <span className="h-px flex-1 bg-amber-deep/40" />
        <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
          included
        </span>
      </div>
      <div className="mt-3 font-mono text-[12px] text-text-high">
        Wet rental — fuel included in hourly rate
      </div>
      <div className="mt-1 font-mono text-tiny text-muted">
        Aircraft will be fueled and ready at departure.
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-amber-deep/30 pt-3 font-mono text-tiny text-muted-dim">
        <div className="flex flex-col">
          <span className="label">Spec range</span>
          <span className="mt-0.5 tabular-nums text-text">~{fmtNm(rangeNm)} nm</span>
        </div>
        <div className="flex flex-col">
          <span className="label">Trip block</span>
          <span className="mt-0.5 tabular-nums text-text">
            ~{tripHours.toFixed(1)} hrs · {fmtNm(tripDistanceNm)} nm
          </span>
        </div>
      </div>
    </div>
  );
}

function FerryFuelPanel({
  rangeNm,
  cruiseSpeedKts,
  tripDistanceNm,
}: {
  rangeNm: number;
  cruiseSpeedKts: number;
  tripDistanceNm: number;
}) {
  const tripHours = cruiseSpeedKts > 0 ? tripDistanceNm / cruiseSpeedKts : 0;
  return (
    <div className="rounded-sm border border-sky-500/40 bg-sky-500/[0.05] p-4">
      <div className="flex items-center gap-2">
        <span className="label text-sky-300/80">Fuel</span>
        <span className="h-px flex-1 bg-sky-500/20" />
        <span className="font-mono text-[10px] uppercase tracking-callsign text-sky-300">
          owner-supplied
        </span>
      </div>
      <div className="mt-3 font-mono text-[12px] text-text-high">
        Ferry contract — fuel and landing fees on the owner's account
      </div>
      <div className="mt-1 font-mono text-tiny text-muted">
        Aircraft will be fueled at {tripDistanceNm > 0 ? "departure" : "the ramp"}.
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-sky-500/20 pt-3 font-mono text-tiny text-muted-dim">
        <div className="flex flex-col">
          <span className="label">Spec range</span>
          <span className="mt-0.5 tabular-nums text-text">~{fmtNm(rangeNm)} nm</span>
        </div>
        <div className="flex flex-col">
          <span className="label">Trip block</span>
          <span className="mt-0.5 tabular-nums text-text">
            ~{tripHours.toFixed(1)} hrs · {fmtNm(tripDistanceNm)} nm
          </span>
        </div>
      </div>
    </div>
  );
}

function OwnedFuelPanel(props: {
  currentFuelGal: number;
  capacityGal: number;
  tripDistanceNm: number;
  originIcao: string;
  fuelType: "avgas" | "jet-a";
  pricePerGal: number;
  recommendedUpliftGal: number;
  fuelInput: string;
  onFuelInputChange: (v: string) => void;
  upliftGal: number;
  fuelValid: boolean;
  headroomGal: number;
  totalFuelGal: number;
  operationalRangeNm: number;
  reservesAtDestNm: number;
  reservesAtDestMin: number;
  fuelCost: number;
  fuelInsufficient: boolean;
  tripUtilization: number;
}) {
  const {
    currentFuelGal,
    capacityGal,
    tripDistanceNm,
    originIcao,
    fuelType,
    pricePerGal,
    recommendedUpliftGal,
    fuelInput,
    onFuelInputChange,
    upliftGal,
    fuelValid,
    headroomGal,
    totalFuelGal,
    operationalRangeNm,
    reservesAtDestNm,
    reservesAtDestMin,
    fuelCost,
    fuelInsufficient,
    tripUtilization,
  } = props;

  const [expanded, setExpanded] = useState(recommendedUpliftGal > 0);
  // Bar tone for the projected total. Below 10% = bad, 10-30% = warn.
  const totalRatio = capacityGal > 0 ? totalFuelGal / capacityGal : 0;
  const tone: "ok" | "warn" | "bad" = fuelInsufficient
    ? "bad"
    : totalRatio < 0.1
      ? "bad"
      : totalRatio < 0.3
        ? "warn"
        : "ok";
  const currentRatio = capacityGal > 0 ? currentFuelGal / capacityGal : 0;
  const sufficientWithoutUplift = recommendedUpliftGal === 0;
  const overCapacity = upliftGal > headroomGal + 1e-6;
  const showCompact = sufficientWithoutUplift && !expanded;

  // Compact form: aircraft is already fueled enough for the trip.
  if (showCompact) {
    return (
      <div className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-4">
        <div className="flex items-center gap-2">
          <span className="label text-amber-glow/80">Fuel</span>
          <span className="h-px flex-1 bg-amber-deep/40" />
          <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
            ready
          </span>
        </div>
        <div className="mt-3 font-mono text-[12px] text-text-high">
          Already fueled for this flight: {fmtGal(currentFuelGal)} / {fmtGal(capacityGal)} gal
        </div>
        <div className="mt-2">
          <FuelBar ratio={currentRatio} tone={tone} />
        </div>
        <div className="mt-3 font-mono text-tiny text-muted">
          Estimated range ~{fmtNm(operationalRangeNm)} nm — comfortable for {fmtNm(tripDistanceNm)} nm trip.
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 font-mono text-[10px] uppercase tracking-callsign text-amber-deep hover:text-amber-glow"
        >
          + Optional: top up to full
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] p-4">
      <div className="flex items-center gap-2">
        <span className="label text-amber-glow/80">Fuel uplift</span>
        <span className="h-px flex-1 bg-amber-deep/40" />
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {recommendedUpliftGal > 0
            ? `reco ${fmtGal(recommendedUpliftGal)} gal`
            : "uplift optional"}
        </span>
      </div>

      {/* Current fuel + capacity */}
      <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-tiny">
        <div className="flex justify-between">
          <span className="text-muted">Current fuel</span>
          <span className="tabular-nums text-text">{fmtGal(currentFuelGal)} gal</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Max capacity</span>
          <span className="tabular-nums text-text">{fmtGal(capacityGal)} gal</span>
        </div>
      </div>
      <div className="mt-2">
        <FuelBar ratio={currentRatio} tone="ok" />
        <div className="mt-1 text-right font-mono text-micro text-muted-dim">
          {Math.round(currentRatio * 100)}%
        </div>
      </div>

      {sufficientWithoutUplift && (
        <div className="mt-3 font-mono text-tiny text-muted">
          Sufficient fuel on board; uplift optional.
        </div>
      )}

      {/* Uplift input */}
      <div className="mt-4 flex items-baseline gap-3">
        <span className="font-mono text-tiny uppercase tracking-callsign text-muted">
          Uplift
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={Math.floor(headroomGal)}
          step={1}
          value={fuelInput}
          onChange={(e) => onFuelInputChange(e.target.value)}
          aria-invalid={!fuelValid || overCapacity}
          className={[
            "w-32 rounded-sm border bg-ink-800 px-3 py-2 text-right font-mono text-[20px] tabular-nums text-text-high outline-none focus:border-amber-glow",
            !fuelValid || overCapacity
              ? "border-urgency-critical/70"
              : "border-ink-600",
          ].join(" ")}
        />
        <span className="font-mono text-tiny uppercase tracking-callsign text-muted-dim">
          gallons
        </span>
        <span className="ml-auto font-mono text-tiny text-muted-dim">
          × {formatCash(pricePerGal)} / gal
        </span>
      </div>

      {overCapacity && (
        <div className="mt-1 font-mono text-micro text-urgency-urgent">
          Exceeds tank headroom ({fmtGal(headroomGal)} gal max)
        </div>
      )}

      {/* After uplift */}
      <div className="mt-4 flex items-center justify-between font-mono text-tiny">
        <span className="text-muted">After uplift</span>
        <span className="tabular-nums text-text-high">
          {fmtGal(totalFuelGal)} / {fmtGal(capacityGal)} gal
        </span>
      </div>
      <div className="mt-2">
        <FuelBar ratio={totalRatio} tone={tone} />
        <div className="mt-1 text-right font-mono text-micro text-muted-dim">
          {Math.round(totalRatio * 100)}%
        </div>
      </div>

      {/* Range / reserves */}
      <div className="mt-4 grid grid-cols-1 gap-1.5 border-t border-amber-deep/30 pt-3 font-mono text-tiny">
        <div className="flex justify-between">
          <span className="text-muted">Estimated range</span>
          <span className="tabular-nums text-text">
            ~{fmtNm(operationalRangeNm)} nm
            <span className="text-muted-dim"> · +45m reserve</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Trip distance</span>
          <span className="tabular-nums text-text">
            {fmtNm(tripDistanceNm)} nm
            <span className="text-muted-dim">
              {" "}
              ({Math.round(tripUtilization * 100)}% used)
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Reserve at dest</span>
          <span
            className={[
              "tabular-nums",
              fuelInsufficient ? "text-urgency-critical" : "text-text",
            ].join(" ")}
          >
            ~{fmtNm(reservesAtDestNm)} nm
            <span className="text-muted-dim">
              {" "}
              ({Math.round(reservesAtDestMin)} min)
            </span>
          </span>
        </div>
      </div>

      {fuelInsufficient && (
        <div className="mt-3 rounded-sm border border-urgency-critical/60 bg-urgency-critical/[0.07] p-2 font-mono text-tiny text-urgency-critical">
          ✗ INSUFFICIENT FUEL — operational range short of trip distance.
        </div>
      )}

      {/* Fuel cost line, prominent per-gal price */}
      <div className="mt-4 flex items-center justify-between border-t border-amber-deep/30 pt-3">
        <div className="flex flex-col">
          <span className="font-mono text-tiny uppercase tracking-callsign text-muted">
            Fuel cost
          </span>
          <span className="mt-0.5 font-mono text-micro text-muted-dim">
            {formatCash(pricePerGal)}/gal {fuelType.toUpperCase()} @ {originIcao}
          </span>
        </div>
        <span className="font-mono text-[18px] tabular-nums text-amber-warm">
          {formatCash(fuelCost)}
        </span>
      </div>
    </div>
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

  // Seed the input from the server's uplift recommendation once. Owned only —
  // rentals skip the uplift step entirely.
  useEffect(() => {
    if (!seededRef.current && active.data && active.data.aircraft.source === "owned") {
      setFuelInput(String(active.data.recommendedFuelUpliftGallons));
      seededRef.current = true;
    }
  }, [active.data]);

  const data = active.data;
  if (!data || data.state !== "accepted") {
    return null;
  }

  const j = data.job;
  const a = data.aircraft;
  const isRental = a.source === "rental";
  const isFerry = a.source === "ferry";
  // Owned aircraft are the only source where the player pays for fuel uplift.
  const noUplift = isRental || isFerry;

  const parsedFuel = Number(fuelInput);
  const fuelValid = noUplift
    ? true
    : Number.isFinite(parsedFuel) && parsedFuel >= 0;
  const headroomGal = Math.max(0, a.fuelCapacityGal - a.currentFuelGal);
  const upliftGal = noUplift
    ? 0
    : Math.max(0, Math.min(headroomGal, fuelValid ? parsedFuel : 0));
  const fuelCost = noUplift
    ? 0
    : Math.round(upliftGal * data.fuelPriceCentsPerGal);
  const cash = career.data?.cash ?? 0;
  const projectedCash = cash - fuelCost;
  const sufficient = projectedCash >= 0;
  const ratedOk = true; // accept already enforced this; informational only
  const atOrigin = a.currentLocationIcao === j.originIcao;
  const within = a.maxPayloadLbs >= j.payloadLbs;

  // Operational projections. Rental: assume full tanks (server reports
  // currentFuelGal = capacity for rentals).
  const totalFuelGal = noUplift ? a.fuelCapacityGal : a.currentFuelGal + upliftGal;
  const reserveGal = 0.75 * a.fuelBurnGph;
  const usableGal = Math.max(0, totalFuelGal - reserveGal);
  const operationalRangeNm =
    a.fuelBurnGph > 0 ? (usableGal / a.fuelBurnGph) * a.cruiseSpeedKts : 0;
  const reservesAtDestNm = Math.max(0, operationalRangeNm - j.distanceNm);
  const reservesAtDestMin =
    a.cruiseSpeedKts > 0 ? (reservesAtDestNm / a.cruiseSpeedKts) * 60 : 0;
  const fuelInsufficient = !noUplift && operationalRangeNm < j.distanceNm;
  const tripUtilization =
    operationalRangeNm > 0 ? Math.min(1, j.distanceNm / operationalRangeNm) : 0;

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

            {isFerry ? (
              <FerryFuelPanel
                rangeNm={a.rangeNm}
                cruiseSpeedKts={a.cruiseSpeedKts}
                tripDistanceNm={j.distanceNm}
              />
            ) : isRental ? (
              <RentalFuelPanel
                rangeNm={a.rangeNm}
                cruiseSpeedKts={a.cruiseSpeedKts}
                tripDistanceNm={j.distanceNm}
              />
            ) : (
              <OwnedFuelPanel
                currentFuelGal={a.currentFuelGal}
                capacityGal={a.fuelCapacityGal}
                tripDistanceNm={j.distanceNm}
                originIcao={j.originIcao}
                fuelType={a.fuelType}
                pricePerGal={data.fuelPriceCentsPerGal}
                recommendedUpliftGal={data.recommendedFuelUpliftGallons}
                fuelInput={fuelInput}
                onFuelInputChange={setFuelInput}
                upliftGal={upliftGal}
                fuelValid={fuelValid}
                headroomGal={headroomGal}
                totalFuelGal={totalFuelGal}
                operationalRangeNm={operationalRangeNm}
                reservesAtDestNm={reservesAtDestNm}
                reservesAtDestMin={reservesAtDestMin}
                fuelCost={fuelCost}
                fuelInsufficient={fuelInsufficient}
                tripUtilization={tripUtilization}
              />
            )}

            {!noUplift && (
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
            )}
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

            <AircraftStatusPanel source={a.source} risk={data.risk} />

            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4 text-tiny leading-relaxed text-muted">
              {isFerry ? (
                <>
                  Once you confirm, the ferry contract locks in as{" "}
                  <span className="text-amber-glow">briefed</span>. Owner
                  covers fuel and fees; you collect the ferry pay on
                  completion.
                </>
              ) : isRental ? (
                <>
                  Once you confirm, the rental is locked in as{" "}
                  <span className="text-amber-glow">briefed</span>. Hourly cost
                  is billed when the flight completes.
                </>
              ) : (
                <>
                  Once you confirm, fuel cost is deducted and the flight is
                  locked in as <span className="text-amber-glow">briefed</span>.
                  Cancelling after this point won't refund the fuel.
                </>
              )}
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
            disabled={
              !sufficient ||
              !fuelValid ||
              fuelInsufficient ||
              briefMutation.isPending ||
              (data.risk?.cannotDispatch ?? false)
            }
            onClick={() => briefMutation.mutate({ fuelGallons: upliftGal })}
            className="group relative rounded-sm border border-amber-glow bg-amber-glow/[0.14] px-6 py-2.5 font-mono text-[12px] uppercase tracking-callsign text-amber-warm shadow-[0_0_0_1px_rgba(212,165,116,0.45),0_0_22px_-6px_rgba(212,165,116,0.55)] hover:bg-amber-glow/[0.22] disabled:opacity-40"
          >
            {briefMutation.isPending
              ? "Confirming…"
              : noUplift
                ? "Confirm brief"
                : `Confirm brief & pay ${formatCash(fuelCost)}`}
            <span className="ml-2 text-amber-deep">▸</span>
          </button>
        </div>
      </div>
    </div>
  );
}
