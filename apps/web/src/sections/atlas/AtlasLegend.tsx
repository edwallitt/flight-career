import { useId, useMemo, useState } from "react";
import {
  FERRY_LINE_COLOR,
  FUEL_PRICE_GRADIENT,
  ROLE_COLOR,
  STATUS_COLOR,
  URGENCY_LINE_STYLE,
  type AtlasLayerSet,
  type FuelPriceRange,
} from "../../components/map/AtlasMap.js";

// Contextual legend for the Atlas map. Only renders sections whose backing
// layer is currently visible — a fixed all-encodings legend would be ~14
// rows and 90% irrelevant at any given moment on a screen-bound map.
//
// Default collapsed so it costs ~28px of map. Expanded width is bounded so
// it doesn't crowd the bottom-left scale bar; if both are visible at once
// the legend stacks above it.

export function AtlasLegend({
  layers,
  fuelOverlayType,
  fuelOverlayRange,
  hasTrackedFlight,
  hasFerryJobs,
}: {
  layers: AtlasLayerSet;
  fuelOverlayType: "avgas" | "jet-a";
  fuelOverlayRange: FuelPriceRange | null;
  hasTrackedFlight: boolean;
  // Only show the ferry row when the player can actually see ferries on the
  // board. Avoids a "what's this sky-blue dashed line" entry that points at
  // nothing on the map.
  hasFerryJobs: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Which sections actually have something to say. If everything is off
  // (e.g. fresh player with only airports + player marker), we render
  // nothing — the chip itself would be noise.
  const sectionFlags = useMemo(
    () => ({
      jobs: layers.jobs,
      fuel: layers.fuelPrices && fuelOverlayRange != null,
      aircraft: layers.ownedAircraft,
      flights: layers.recentFlights,
      tracked: layers.trackedFlight && hasTrackedFlight,
    }),
    [layers, fuelOverlayRange, hasTrackedFlight],
  );
  const anyVisible = Object.values(sectionFlags).some(Boolean);
  if (!anyVisible) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Show map legend"
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-sm border border-amber-deep/40 bg-ink-900/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-callsign text-amber-glow backdrop-blur-sm hover:bg-ink-800/85"
      >
        <LegendIcon />
        Legend
      </button>
    );
  }

  return (
    <div className="pointer-events-auto w-[260px] rounded-sm border border-amber-deep/40 bg-ink-900/85 font-mono text-[10px] uppercase tracking-callsign backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-ink-700/60 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-amber-glow">
          <LegendIcon />
          Legend
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide legend"
          className="rounded-sm px-1 text-muted-dim hover:text-amber-glow"
        >
          ▾
        </button>
      </div>

      <div className="flex flex-col">
        {sectionFlags.jobs && <JobsSection hasFerry={hasFerryJobs} />}
        {sectionFlags.fuel && fuelOverlayRange && (
          <FuelSection
            range={fuelOverlayRange}
            fuelType={fuelOverlayType}
          />
        )}
        {sectionFlags.aircraft && <AircraftSection />}
        {sectionFlags.flights && <RecentFlightsSection />}
        {sectionFlags.tracked && <TrackedSection />}
      </div>
    </div>
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
    <div className="border-b border-ink-800 px-2.5 py-2 last:border-b-0">
      <div className="mb-1.5 text-muted-faint">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

// A horizontal swatch + label row. The swatch is a stubby line so the colour
// reads against the dark backdrop — a small filled circle is too small to
// distinguish e.g. light-jet violet from owned-aircraft amber at a glance.
function SwatchRow({
  swatch,
  label,
  sub,
}: {
  swatch: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-2 w-6 items-center">{swatch}</span>
      <span className="text-text">{label}</span>
      {sub && <span className="text-muted-faint">· {sub}</span>}
    </div>
  );
}

function ColorBar({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="24" height="6" viewBox="0 0 24 6" aria-hidden>
      <line
        x1="0"
        y1="3"
        x2="24"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

function JobsSection({ hasFerry }: { hasFerry: boolean }) {
  return (
    <Section title="Jobs · by role">
      <SwatchRow swatch={<ColorBar color={ROLE_COLOR.bush} dash="3 2" />} label="Bush" />
      <SwatchRow swatch={<ColorBar color={ROLE_COLOR.air_taxi} dash="3 2" />} label="Air taxi" />
      <SwatchRow swatch={<ColorBar color={ROLE_COLOR.light_jet} dash="3 2" />} label="Light jet" />
      <SwatchRow swatch={<ColorBar color={ROLE_COLOR.open} dash="3 2" />} label="Open market" />
      {hasFerry && (
        <SwatchRow
          swatch={<ColorBar color={FERRY_LINE_COLOR} dash="5 3" />}
          label="Ferry"
          sub="longer dash"
        />
      )}

      <div className="mt-2 mb-1 text-muted-faint">Job · per row</div>
      {/* Direction + endpoint hints. Use the same role-bush green for the
         swatch shapes because the player's first jobs are nearly always
         bush, so the colour matches their muscle memory of the lines. */}
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-6 items-center justify-center text-[12px] text-amber-glow">
          ▶
        </span>
        <span className="text-text">Direction</span>
        <span className="text-muted-faint">· origin → dest</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-6 items-center justify-center">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: ROLE_COLOR.bush }}
          />
        </span>
        <span className="text-text">Origin</span>
        <span className="text-muted-faint">· filled dot</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-6 items-center justify-center">
          <span
            className="h-2 w-2 rounded-full border"
            style={{ borderColor: ROLE_COLOR.bush }}
          />
        </span>
        <span className="text-text">Destination</span>
        <span className="text-muted-faint">· hollow ring</span>
      </div>

      <div className="mt-2 mb-1 text-muted-faint">Urgency · line width</div>
      {/* Read straight from the shared URGENCY_LINE_STYLE table so the legend
         and the map can't drift. legendWidth/legendOpacity are bolder than
         the map values on purpose — explained alongside the constant. */}
      <div className="flex items-center gap-3 pl-1">
        {URGENCY_LINE_STYLE.map((row) => (
          <UrgencyTick
            key={row.urgency}
            label={URGENCY_SHORT_LABEL[row.urgency]}
            width={row.legendWidth}
            opacity={row.legendOpacity}
          />
        ))}
      </div>
    </Section>
  );
}

const URGENCY_SHORT_LABEL: Record<
  (typeof URGENCY_LINE_STYLE)[number]["urgency"],
  string
> = {
  critical: "Crit",
  urgent: "Urg",
  standard: "Std",
  flexible: "Flex",
};

function UrgencyTick({
  label,
  width,
  opacity,
}: {
  label: string;
  width: number;
  opacity: number;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
        <line
          x1="0"
          y1="4"
          x2="22"
          y2="4"
          stroke={ROLE_COLOR.bush}
          strokeOpacity={opacity}
          strokeWidth={width}
          strokeDasharray="3 2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[9px] text-muted-faint">{label}</span>
    </div>
  );
}

function FuelSection({
  range,
  fuelType,
}: {
  range: FuelPriceRange;
  fuelType: "avgas" | "jet-a";
}) {
  const fmt = (v: number) =>
    `$${v.toFixed(2)}`;
  const gradient = `linear-gradient(to right, ${FUEL_PRICE_GRADIENT.cheap}, ${FUEL_PRICE_GRADIENT.mid}, ${FUEL_PRICE_GRADIENT.expensive})`;
  return (
    <Section
      title={`Fuel prices · ${fuelType === "jet-a" ? "Jet-A" : "Avgas"} · per gal`}
    >
      <div
        className="h-2 w-full rounded-sm"
        style={{ backgroundImage: gradient }}
        aria-label="Fuel price gradient: cheap (green) to expensive (red)"
      />
      <div className="flex justify-between text-[10px] tabular-nums text-muted">
        <span>{fmt(range.lo)}</span>
        <span>{fmt(range.mid)}</span>
        <span>{fmt(range.hi)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-sm"
          style={{ backgroundColor: FUEL_PRICE_GRADIENT.noData }}
        />
        <span className="text-muted">No sale</span>
        <span className="text-muted-faint">· grey marker</span>
      </div>
    </Section>
  );
}

function AircraftSection() {
  return (
    <Section title="Owned aircraft · status">
      <SwatchRow
        swatch={<StatusDot color={STATUS_COLOR.available} />}
        label="Available"
      />
      <SwatchRow
        swatch={<StatusDot color={STATUS_COLOR.in_flight} />}
        label="In flight"
      />
      <SwatchRow
        swatch={<StatusDot color={STATUS_COLOR.in_maintenance} />}
        label="In maintenance"
      />
      <SwatchRow
        swatch={<StatusDot color={STATUS_COLOR.committed} />}
        label="Committed"
      />
    </Section>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function RecentFlightsSection() {
  // useId gives a stable, document-unique gradient id per legend instance.
  // Without it, two AtlasLegend mounts (split-screen, StrictMode dev double
  // render, etc.) would collide on `id="ageFade"` and the second instance's
  // gradient would silently resolve to the first's.
  const reactId = useId();
  const gradientId = `ageFade-${reactId}`;
  return (
    <Section title="Recent flights · age">
      <div className="flex items-center gap-2">
        <svg width="48" height="8" viewBox="0 0 48 8" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1">
              <stop offset="0" stopColor="#d4a574" stopOpacity="0.7" />
              <stop offset="1" stopColor="#d4a574" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1="4"
            x2="48"
            y2="4"
            stroke={`url(#${gradientId})`}
            strokeWidth="2"
            strokeDasharray="2 2"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-text">Today</span>
        <span className="text-muted-faint">→ 30 d</span>
      </div>
    </Section>
  );
}

function TrackedSection() {
  return (
    <Section title="Tracked flight · live">
      <SwatchRow
        swatch={<ColorBar color="#5ec47c" />}
        label="MSFS bridge"
        sub="solid line"
      />
    </Section>
  );
}

function LegendIcon() {
  // A small "list" glyph — three short horizontal ticks. Visually distinct
  // from the OPS badge's dot at top-left and the layer panel's swatches.
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="2" width="3" height="1.4" fill="currentColor" />
      <rect x="5" y="2" width="4" height="1.4" fill="currentColor" />
      <rect x="1" y="4.3" width="3" height="1.4" fill="currentColor" />
      <rect x="5" y="4.3" width="4" height="1.4" fill="currentColor" />
      <rect x="1" y="6.6" width="3" height="1.4" fill="currentColor" />
      <rect x="5" y="6.6" width="4" height="1.4" fill="currentColor" />
    </svg>
  );
}
