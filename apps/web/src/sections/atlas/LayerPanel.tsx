import type {
  AtlasLayerSet,
  FuelPriceRange,
} from "../../components/map/AtlasMap.js";

interface LayerPanelProps {
  layers: AtlasLayerSet;
  counts: {
    airports: number;
    ownedAircraft: number;
    recentFlights: number;
    jobs: number;
    player: number;
  };
  onChange: (next: AtlasLayerSet) => void;
  fuelOverlayType?: "avgas" | "jet-a";
  fuelOverlayRange?: FuelPriceRange | null;
  // True only while an in_progress MSFS-tracked flight exists. The Live Track
  // row is hidden otherwise to keep the panel quiet.
  hasTrackedFlight?: boolean;
  // When non-null, the range rings drive off this aircraft. We surface its
  // tail + range in a small footnote so the player understands *why* a given
  // airport is dimmed (or not). Null suppresses both the rings and the
  // explanatory copy.
  rangeAnchor?: {
    rangeNm: number;
    tailNumber: string;
    aircraftTypeLabel: string;
  } | null;
}

function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ToggleRow({
  on,
  onClick,
  label,
  count,
  swatch,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors",
        on
          ? "bg-amber-glow/[0.04] hover:bg-amber-glow/[0.08]"
          : "hover:bg-ink-750/60",
      ].join(" ")}
    >
      {/* Pill switch */}
      <span
        className={[
          "flex h-4 w-7 shrink-0 items-center rounded-full border px-0.5 transition-colors",
          on
            ? "border-amber-deep bg-amber-glow/20"
            : "border-ink-500 bg-ink-700",
        ].join(" ")}
      >
        <span
          className={[
            "block h-3 w-3 rounded-full transition-transform duration-200",
            on
              ? "translate-x-3 bg-amber-glow shadow-[0_0_4px_rgba(212,165,116,0.6)]"
              : "translate-x-0 bg-muted-dim",
          ].join(" ")}
        />
      </span>

      {/* Swatch */}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {swatch}
      </span>

      {/* Label */}
      <span
        className={[
          "flex-1 font-mono text-[11px] uppercase tracking-callsign",
          on ? "text-text" : "text-muted",
        ].join(" ")}
      >
        {label}
      </span>

      {/* Count */}
      {count != null && (
        <span
          className={[
            "font-mono text-[10px] tabular-nums",
            on ? "text-amber-glow" : "text-muted-faint",
          ].join(" ")}
        >
          {String(count).padStart(2, "0")}
        </span>
      )}
    </button>
  );
}

// Swatches reused by both the primary rows and the "More layers" disclosure.
const SWATCH = {
  jobs: <span className="text-amber-glow text-[10px]">▲</span>,
  playerLocation: (
    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(94,196,124,0.7)]" />
  ),
  // Two concentric arcs — same idiom the map uses for range rings.
  reach: (
    <span className="relative block h-3 w-3">
      <span className="absolute inset-0 rounded-full border border-amber-deep/80" />
      <span className="absolute inset-[3px] rounded-full border border-dashed border-amber-deep/60" />
    </span>
  ),
  trackedFlight: (
    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(94,196,124,0.8)]" />
  ),
  airports: (
    <span className="h-2 w-2 rounded-full border border-amber-deep bg-amber-glow/40" />
  ),
  ownedAircraft: <span className="text-amber-glow text-[11px]">✈</span>,
  recentFlights: (
    <span className="block h-px w-3 border-t border-dashed border-amber-deep" />
  ),
  fuelPrices: (
    <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-emerald-400 via-amber-glow to-rose-400" />
  ),
  nightShade: (
    <span className="flex h-3 w-3 overflow-hidden rounded-full border border-amber-deep/60">
      <span className="h-full w-1/2 bg-amber-glow/40" />
      <span className="h-full w-1/2 bg-[#0b1a2a]" />
    </span>
  ),
} as const;

export function LayerPanel({
  layers,
  counts,
  onChange,
  fuelOverlayType,
  fuelOverlayRange,
  hasTrackedFlight = false,
  rangeAnchor = null,
}: LayerPanelProps) {
  const toggle = (key: keyof AtlasLayerSet) =>
    onChange({ ...layers, [key]: !layers[key] });

  // Range rings + reachability dim are two halves of one idea ("what can I
  // reach right now"), so the panel drives them with a single switch. We
  // read the on-state from rangeRings and mirror both on toggle.
  const reachOn = layers.rangeRings;
  const toggleReach = () =>
    onChange({ ...layers, rangeRings: !reachOn, reachabilityDim: !reachOn });

  return (
    <div className="flex flex-col">
      {/* Primary layers — the few that serve "which job next." */}
      <div className="px-3 pt-4 pb-3">
        <div className="mb-1.5 px-1 label">Layers</div>
        <div className="flex flex-col gap-0.5">
          <ToggleRow
            on={layers.jobs}
            onClick={() => toggle("jobs")}
            label="Open jobs"
            count={counts.jobs}
            swatch={SWATCH.jobs}
          />
          <ToggleRow
            on={reachOn}
            onClick={toggleReach}
            label="Reachable range"
            swatch={SWATCH.reach}
          />
          <ToggleRow
            on={layers.playerLocation}
            onClick={() => toggle("playerLocation")}
            label="My position"
            count={counts.player}
            swatch={SWATCH.playerLocation}
          />
          {/* Live track only appears while a tracked flight is in progress —
              it's the highest-signal layer at that moment, so it stays in
              the primary group rather than the disclosure. */}
          {hasTrackedFlight && (
            <ToggleRow
              on={layers.trackedFlight}
              onClick={() => toggle("trackedFlight")}
              label="Live track"
              swatch={SWATCH.trackedFlight}
            />
          )}
        </div>
      </div>

      {/* More layers — context/decoration, collapsed by default so the panel
          stays focused on jobs. */}
      <details className="group border-t border-ink-600/70 px-3 py-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-1 font-mono text-micro uppercase tracking-callsign text-muted-faint hover:text-muted">
          <span>More layers</span>
          <span className="text-[10px] transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-0.5">
          <ToggleRow
            on={layers.airports}
            onClick={() => toggle("airports")}
            label="Airports"
            count={counts.airports}
            swatch={SWATCH.airports}
          />
          <ToggleRow
            on={layers.ownedAircraft}
            onClick={() => toggle("ownedAircraft")}
            label="My fleet"
            count={counts.ownedAircraft}
            swatch={SWATCH.ownedAircraft}
          />
          <ToggleRow
            on={layers.recentFlights}
            onClick={() => toggle("recentFlights")}
            label="Recent flights"
            count={counts.recentFlights}
            swatch={SWATCH.recentFlights}
          />
          <ToggleRow
            on={layers.fuelPrices}
            onClick={() => toggle("fuelPrices")}
            label="Fuel overlay"
            swatch={SWATCH.fuelPrices}
          />
          <ToggleRow
            on={layers.nightShade}
            onClick={() => toggle("nightShade")}
            label="Night shade"
            swatch={SWATCH.nightShade}
          />
        </div>
      </details>

      {layers.fuelPrices && fuelOverlayType && (
        <div className="border-t border-ink-600/70 px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label">Fuel price</span>
            <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
              {fuelOverlayType === "jet-a" ? "Jet A" : "Avgas"}
            </span>
          </div>
          <div className="h-2 w-full rounded-sm bg-gradient-to-r from-[#5ec47c] via-[#cfcfcf] to-[#e34d4d]" />
          {fuelOverlayRange ? (
            <div className="mt-1.5 flex items-baseline justify-between font-mono text-[10px] tabular-nums text-muted-dim">
              <span>{formatPriceCents(fuelOverlayRange.lo)}/gal</span>
              <span>{formatPriceCents(fuelOverlayRange.hi)}/gal</span>
            </div>
          ) : (
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
              No price data
            </div>
          )}
          <div className="mt-2 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
            Showing {fuelOverlayType === "jet-a" ? "Jet A" : "Avgas"} prices
          </div>
        </div>
      )}

      {/* Range anchor footnote. Only renders when the player has an eligible
          aircraft sitting at their current airport — otherwise the rings
          would be a phantom UI. */}
      {layers.rangeRings && rangeAnchor && (
        <div className="border-t border-ink-600/70 px-4 py-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="label">Range</span>
            <span className="font-mono text-[10px] tabular-nums text-amber-glow">
              {rangeAnchor.rangeNm.toLocaleString()} nm
            </span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-callsign text-muted">
            <span className="icao text-text">{rangeAnchor.tailNumber}</span>
            <span className="ml-1 text-muted-faint">
              · {rangeAnchor.aircraftTypeLabel}
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
            Inner ring = w/ 15% reserve
          </div>
        </div>
      )}
      {layers.rangeRings && !rangeAnchor && (
        <div className="border-t border-ink-600/70 px-4 py-3">
          <div className="mb-1 label">Range</div>
          <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
            No available aircraft at your location
          </div>
        </div>
      )}

      {/* Collapsible legend — closed by default. */}
      <details className="group border-t border-ink-600/70 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-micro uppercase tracking-callsign text-muted-faint hover:text-muted">
          <span>Legend</span>
          <span className="text-[10px] transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 font-mono text-[10px] uppercase tracking-callsign text-muted">
          <li className="flex items-center gap-2">
            <span className="relative flex h-3 w-3 items-center justify-center">
              <span className="absolute h-3 w-3 rounded-full border border-amber-deep/40" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow" />
            </span>
            Major airport
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-warm/70" />
            Regional airport
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-deep/70" />
            Small / remote field
          </li>
          <li className="flex items-center gap-2">
            <span className="text-amber-glow">✈</span>
            Owned aircraft
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(94,196,124,0.6)]" />
            Your position
          </li>
          <li className="flex items-center gap-2">
            <span className="block h-px w-4 border-t border-dashed border-amber-deep" />
            Recent flight
          </li>
          <li className="flex items-center gap-2">
            <span className="text-amber-glow">▲</span>
            Job origin
          </li>
        </ul>
      </details>
    </div>
  );
}
