import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { formatCash } from "../../lib/formatters.js";
import { SectionHeader } from "./SectionHeader.js";

type Snapshot = NonNullable<inferRouterOutputs<AppRouter>["career"]["snapshot"]>;
type Data = Snapshot["milestones"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatNm(nm: number): string {
  if (nm <= 0) return "—";
  return `${Math.round(nm).toLocaleString("en-US")} nm`;
}

// "Telemetry plate" — bigger stat for the headline cards. Bottom strip carries
// the unit + a secondary readout so the card doesn't feel empty.
function HeroStat({
  label,
  code,
  value,
  unit,
  meta,
  isEmpty = false,
  emptyHint,
}: {
  label: string;
  code: string;
  value: string;
  unit?: string;
  meta?: string;
  isEmpty?: boolean;
  emptyHint?: string;
}) {
  return (
    <div className="relative flex flex-col gap-3 rounded-sm border border-ink-600 bg-ink-800/55 p-5">
      <span className="pointer-events-none absolute right-0 top-0 h-2 w-2 border-r border-t border-amber-deep/60" />
      <span className="pointer-events-none absolute left-0 bottom-0 h-2 w-2 border-l border-b border-amber-deep/40" />

      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          {label}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-callsign text-amber-deep">
          {code}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={[
            "font-display text-[42px] font-semibold leading-none tracking-tight tabular-nums",
            isEmpty ? "text-muted-faint" : "text-amber-warm",
          ].join(" ")}
        >
          {isEmpty ? "—" : value}
        </span>
        {unit && !isEmpty && (
          <span className="font-mono text-[11px] uppercase tracking-wide2 text-muted">
            {unit}
          </span>
        )}
      </div>

      <div className="mt-auto border-t border-ink-700/50 pt-2 font-mono text-[10px] tabular-nums text-muted-dim">
        {isEmpty ? (emptyHint ?? "Awaiting data.") : (meta ?? "")}
      </div>
    </div>
  );
}

// Secondary "panel readout" — denser, less visual weight than the hero plates.
function PanelStat({
  label,
  value,
  meta,
  isEmpty = false,
  emptyHint,
  glyph,
}: {
  label: string;
  value: string;
  meta?: string;
  isEmpty?: boolean;
  emptyHint?: string;
  glyph?: string;
}) {
  return (
    <div className="relative flex flex-col gap-1.5 rounded-sm border border-ink-600/70 bg-ink-800/30 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          {label}
        </span>
        {glyph && (
          <span className="font-mono text-[10px] text-amber-deep/70">
            {glyph}
          </span>
        )}
      </div>
      <span
        className={[
          "font-display text-[22px] font-semibold leading-none tracking-tight tabular-nums",
          isEmpty ? "text-muted-faint" : "text-text-high",
        ].join(" ")}
      >
        {isEmpty ? "—" : value}
      </span>
      <div className="font-mono text-[10px] tabular-nums text-muted-dim">
        {isEmpty ? (emptyHint ?? "—") : (meta ?? "")}
      </div>
    </div>
  );
}

export function Milestones({ data }: { data: Data }) {
  const careerDays = Math.max(
    1,
    Math.floor((data.simNow - data.careerStartedAt) / MS_PER_DAY) + 1,
  );

  // Hero readouts: flights, hours, earnings (the three numbers a player wants
  // first and keeps wanting).
  const heroFlights = data.totalFlights > 0 ? String(data.totalFlights) : "—";
  const heroHours =
    data.totalBlockMinutes > 0 ? formatHours(data.totalBlockMinutes) : "—";
  const heroEarnings =
    data.totalEarnings > 0 ? formatCash(data.totalEarnings) : "—";

  const longestSubtitle = data.longestFlight
    ? `${data.longestFlight.originIcao} → ${data.longestFlight.destinationIcao}`
    : null;

  const favoriteRouteValue = data.favoriteRoute
    ? `${data.favoriteRoute.origin} → ${data.favoriteRoute.destination}`
    : null;
  const favoriteRouteSubtitle = data.favoriteRoute
    ? `flown ${data.favoriteRoute.count}×`
    : null;

  const topClientValue = data.topClient ? data.topClient.name : null;
  const topClientSubtitle = data.topClient
    ? `${data.topClient.flightCount} ${data.topClient.flightCount === 1 ? "flight" : "flights"} · ${formatCash(data.topClient.totalEarnings)}`
    : null;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        index="03"
        code="MIL"
        label="Telemetry"
        title="Milestones"
        hint={`day ${careerDays}`}
      />

      {/* Hero row: 3 prominent stats */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroStat
          label="Flights logged"
          code="FLT"
          value={heroFlights}
          unit={data.totalFlights === 1 ? "sortie" : "sorties"}
          meta={`across ${careerDays} sim ${careerDays === 1 ? "day" : "days"}`}
          isEmpty={data.totalFlights === 0}
          emptyHint="Fly your first sortie."
        />
        <HeroStat
          label="Block time"
          code="BLK"
          value={heroHours}
          meta={`${(data.totalBlockMinutes / 60).toFixed(1)} hrs total`}
          isEmpty={data.totalBlockMinutes === 0}
          emptyHint="Hours accrue with each flight."
        />
        <HeroStat
          label="Gross revenue"
          code="REV"
          value={heroEarnings}
          meta="lifetime · pre-cost"
          isEmpty={data.totalEarnings === 0}
          emptyHint="Earnings begin at first delivery."
        />
      </div>

      {/* Secondary row: smaller readouts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <PanelStat
          label="Distance"
          glyph="→"
          value={data.totalDistanceNm > 0 ? formatNm(data.totalDistanceNm) : "—"}
          meta="sum of legs"
          isEmpty={data.totalDistanceNm === 0}
          emptyHint="No range covered yet."
        />
        <PanelStat
          label="Longest leg"
          glyph="↦"
          value={data.longestFlight ? formatNm(data.longestFlight.distanceNm) : "—"}
          meta={longestSubtitle ?? undefined}
          isEmpty={data.longestFlight == null}
          emptyHint="No long-haul yet."
        />
        <PanelStat
          label="Airports"
          glyph="◉"
          value={
            data.uniqueAirportsVisited > 0
              ? String(data.uniqueAirportsVisited)
              : "—"
          }
          meta="distinct ICAOs"
          isEmpty={data.uniqueAirportsVisited === 0}
          emptyHint="No airfields touched."
        />
        <PanelStat
          label="Favourite route"
          glyph="⇌"
          value={favoriteRouteValue ?? "—"}
          meta={favoriteRouteSubtitle ?? undefined}
          isEmpty={favoriteRouteValue == null}
          emptyHint="Fly 3+ with a repeat."
        />
        <PanelStat
          label="Top client"
          glyph="◇"
          value={topClientValue ?? "—"}
          meta={topClientSubtitle ?? undefined}
          isEmpty={topClientValue == null}
          emptyHint="No client streak yet."
        />
      </div>
    </section>
  );
}
