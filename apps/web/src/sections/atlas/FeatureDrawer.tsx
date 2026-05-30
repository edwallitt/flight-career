import type {
  AtlasAirport,
  AtlasData,
  AtlasFeatureRef,
  AtlasJob,
  AtlasOwnedAircraft,
  AtlasRecentFlight,
} from "../../components/map/AtlasMap.js";
import {
  formatPay,
  formatPayloadType,
  formatRelativeFromNow,
  formatSimDateTime,
  ROLE_LABEL,
} from "../../lib/formatters.js";
import { trpc } from "../../trpc.js";
import { FuelSparkline } from "./FuelSparkline.js";

interface FeatureDrawerProps {
  feature: AtlasFeatureRef | null;
  data: AtlasData | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3 3 L13 13 M13 3 L3 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Field({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className={[
        "flex flex-col gap-0.5",
        align === "right" && "items-end text-right",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="label">{label}</span>
      <span className="font-mono text-[12px] text-text-high">{children}</span>
    </div>
  );
}

function dms(value: number, hemPos: string, hemNeg: string): string {
  const hem = value >= 0 ? hemPos : hemNeg;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${String(deg).padStart(2, "0")}°${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"${hem}`;
}

function formatDMS(lat: number, lon: number): { lat: string; lon: string } {
  return {
    lat: dms(lat, "N", "S"),
    lon: dms(lon, "E", "W"),
  };
}

const STATUS_LABEL: Record<AtlasOwnedAircraft["status"], string> = {
  available: "Available",
  in_flight: "In flight",
  in_maintenance: "In maintenance",
  committed: "Committed",
};

const STATUS_TONE: Record<AtlasOwnedAircraft["status"], string> = {
  available: "text-emerald-300",
  in_flight: "text-sky-300",
  in_maintenance: "text-urgency-critical",
  committed: "text-muted",
};

// ---------------------------------------------------------------------------
// Drawers per feature type
// ---------------------------------------------------------------------------

function AirportDrawer({
  airport,
  data,
  onNavigate,
}: {
  airport: AtlasAirport;
  data: AtlasData;
  onNavigate: (path: string) => void;
}) {
  const isHere = data.player?.currentLocationIcao === airport.icao;
  const ownedHere = data.ownedAircraft.filter(
    (a) => a.currentLocationIcao === airport.icao,
  );
  const jobsFromHere = data.jobs.filter((j) => j.originIcao === airport.icao);
  const coords = formatDMS(airport.lat, airport.lon);

  const tierTone =
    airport.size === "major"
      ? "text-amber-glow"
      : airport.size === "regional"
        ? "text-amber-warm"
        : "text-muted";

  return (
    <div className="flex flex-col gap-4">
      {/* Activity block lives at the top now — these are the actionable
          counts the player came to the drawer for. Each row is a button so
          "5 open jobs from here" goes straight to a filtered Job Board view
          instead of forcing a second navigation step. */}
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Activity</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {isHere && (
            <div className="flex items-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/[0.06] px-2.5 py-1.5 font-mono text-[12px] uppercase tracking-callsign text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(94,196,124,0.7)]" />
              You're here
            </div>
          )}
          <ActivityRow
            count={jobsFromHere.length}
            label="Open jobs from here"
            disabled={jobsFromHere.length === 0}
            // Job Board doesn't yet consume an ?origin= filter — drop the
            // misleading param. Once the board supports it the link can be
            // re-targeted without changing the affordance.
            onClick={() => onNavigate(`/jobs`)}
          />
          <ActivityRow
            count={ownedHere.length}
            label="Your aircraft here"
            disabled={ownedHere.length === 0}
            // Hangar doesn't filter by airport yet — plain navigation puts the
            // player on the fleet list and lets them spot their aircraft
            // there. A misleading `?location=` would imply filtering that
            // isn't wired.
            onClick={() => onNavigate(`/hangar`)}
          />
          {!isHere && ownedHere.length === 0 && jobsFromHere.length === 0 && (
            <div className="font-mono text-[12px] text-muted-dim">
              No current activity
            </div>
          )}
        </div>
      </div>

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Tier">
            <span className={["capitalize", tierTone].join(" ")}>
              {airport.size}
            </span>
          </Field>
          <Field label="Country" align="right">
            {airport.country}
          </Field>
          <Field label="Region">
            <span className="capitalize">{airport.region}</span>
          </Field>
          <Field label="Longest runway" align="right">
            {airport.longestRunwayFt.toLocaleString()} ft
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-ink-600/70 pt-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
              LAT
            </span>
            <span className="font-mono text-[12px] tabular-nums text-text-high">
              {coords.lat}
            </span>
          </div>
          <div className="flex items-baseline justify-end gap-2">
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
              LON
            </span>
            <span className="font-mono text-[12px] tabular-nums text-text-high">
              {coords.lon}
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-ink-600/70 pt-3 font-mono text-[10px] uppercase tracking-callsign">
          <span className="text-muted-faint">Services</span>
          <span
            className={[
              "rounded-sm border px-1.5 py-px",
              airport.hasFbo
                ? "border-amber-deep/50 bg-amber-glow/[0.06] text-amber-glow"
                : "border-ink-600 text-muted-faint",
            ].join(" ")}
          >
            FBO
          </span>
          <span
            className={[
              "rounded-sm border px-1.5 py-px",
              airport.hasMaintenance
                ? "border-amber-deep/50 bg-amber-glow/[0.06] text-amber-glow"
                : "border-ink-600 text-muted-faint",
            ].join(" ")}
          >
            MX
          </span>
        </div>
      </div>

      <FuelBlock airport={airport} data={data} />


      {!isHere && (
        <PrimaryAction
          label="Travel here"
          onClick={() => onNavigate(`/jobs?travelTo=${airport.icao}`)}
        />
      )}
    </div>
  );
}

// Fuel block for the airport drawer. Promotes the existing per-gallon
// price reading with two planning numbers the player actually needs:
//   • Δ vs home — green when cheaper than the player's current airport,
//     red when dearer. Headline number for the "should I top up here?"
//     decision. Suppressed when the player has no home (fresh career) or
//     when the home airport doesn't sell this fuel type.
//   • Cost to fill — how much it would cost to tank up the *anchor
//     aircraft* (the one currently driving the range rings). We only
//     render this for the matching fuel type; the other column stays
//     informational because tanking a Jet-A burner with Avgas isn't a
//     decision the player ever makes.
function FuelBlock({
  airport,
  data,
}: {
  airport: AtlasAirport;
  data: AtlasData;
}) {
  // The home airport is wherever the player currently sits. That's also
  // where the range anchor's aircraft lives, so this naturally aligns
  // with the planning model.
  const home =
    data.player &&
    data.airports.find((a) => a.icao === data.player!.currentLocationIcao);
  const isHere = home?.icao === airport.icao;

  // Pick the anchor aircraft: longest-range available aircraft at the
  // player's airport (same heuristic Atlas.tsx uses for the range anchor
  // so the chip's "Range · N172DH" and the cost-to-fill stay in lockstep).
  const anchor =
    data.player &&
    data.ownedAircraft
      .filter(
        (a) =>
          a.status === "available" &&
          a.currentLocationIcao === data.player!.currentLocationIcao,
      )
      .sort((a, b) => b.rangeNm - a.rangeNm)[0];

  return (
    <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
      <div className="flex items-center gap-2">
        <span className="label">Fuel</span>
        <span className="h-px flex-1 bg-ink-600" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <FuelColumn
          label="Avgas"
          align="left"
          price={airport.fuelPriceAvgas}
          homePrice={home?.fuelPriceAvgas ?? null}
          showCostToFill={!isHere && anchor?.fuelType === "avgas"}
          tankGal={anchor?.fuelType === "avgas" ? anchor.fuelCapacityGal : 0}
          anchorTail={anchor?.fuelType === "avgas" ? anchor.tailNumber : null}
          icao={airport.icao}
        />
        <FuelColumn
          label="Jet A"
          align="right"
          price={airport.fuelPriceJetA}
          homePrice={home?.fuelPriceJetA ?? null}
          showCostToFill={!isHere && anchor?.fuelType === "jet-a"}
          tankGal={anchor?.fuelType === "jet-a" ? anchor.fuelCapacityGal : 0}
          anchorTail={anchor?.fuelType === "jet-a" ? anchor.tailNumber : null}
          icao={airport.icao}
        />
      </div>
    </div>
  );
}

function FuelColumn({
  label,
  align,
  price,
  homePrice,
  showCostToFill,
  tankGal,
  anchorTail,
  icao,
}: {
  label: string;
  align: "left" | "right";
  price: number | null;
  homePrice: number | null;
  showCostToFill: boolean;
  tankGal: number;
  anchorTail: string | null;
  icao: string;
}) {
  const fuelType = label === "Jet A" ? "jet-a" : "avgas";
  const itemsAlign = align === "right" ? "items-end text-right" : "";
  const rowAlign = align === "right" ? "justify-end" : "";

  // Δ-vs-home — only meaningful when both sides quote the same fuel type
  // and we're not staring at the home airport. Sign convention: negative
  // = cheaper here, the lever the player wants to pull.
  let delta: number | null = null;
  if (price != null && homePrice != null) {
    delta = price - homePrice;
  }
  const deltaTone =
    delta == null
      ? ""
      : delta < 0
        ? "text-emerald-300"
        : delta > 0
          ? "text-urgency-critical"
          : "text-muted";
  const deltaSign = delta == null ? "" : delta > 0 ? "+" : "";

  // Cost to fill is integer dollars — the precision past that is noise at
  // this stage of planning (taxes / fees are still TBD anyway).
  const fillCost =
    showCostToFill && price != null && tankGal > 0
      ? Math.round((tankGal * price) / 100)
      : null;

  return (
    <div className={["flex flex-col gap-0.5", itemsAlign].join(" ")}>
      <span className="label">{label}</span>
      <span className="font-mono text-[12px] text-text-high">
        {price == null ? "—" : `$${(price / 100).toFixed(2)}/gal`}
      </span>
      {delta != null && (
        <div
          className={[
            "flex items-baseline gap-1 font-mono text-[10px] uppercase tracking-callsign tabular-nums",
            rowAlign,
            deltaTone,
          ].join(" ")}
        >
          <span>
            {deltaSign}
            {(delta / 100).toFixed(2)}
          </span>
          <span className="text-muted-faint">vs home</span>
        </div>
      )}
      {fillCost != null && anchorTail && (
        <div
          className={[
            "mt-1 flex flex-col gap-px font-mono text-[10px] uppercase tracking-callsign",
            itemsAlign,
          ].join(" ")}
        >
          <span className="text-muted-faint">
            Fill {tankGal}gal {anchorTail}
          </span>
          <span className="text-amber-warm tabular-nums">
            ${fillCost.toLocaleString()}
          </span>
        </div>
      )}
      {price != null && (
        <FuelSparkline airportIcao={icao} fuelType={fuelType} />
      )}
    </div>
  );
}

// Compact, clickable activity row. Disabled (zero-count) variants still
// render so the drawer's vertical rhythm doesn't jump as the player pans
// between airports — they read as "nothing to see here" but the layout is
// stable.
function ActivityRow({
  count,
  label,
  onClick,
  disabled,
}: {
  count: number;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "group flex w-full items-center gap-3 rounded-sm border px-2.5 py-1.5 text-left transition-colors",
        disabled
          ? "border-ink-600/60 bg-transparent"
          : "border-ink-600 bg-ink-700 hover:border-amber-deep hover:bg-amber-glow/[0.06]",
      ].join(" ")}
    >
      <span
        className={[
          "min-w-[1.5rem] font-mono tabular-nums text-[14px]",
          disabled ? "text-muted-faint" : "text-amber-glow",
        ].join(" ")}
      >
        {String(count).padStart(2, "0")}
      </span>
      <span
        className={[
          "flex-1 font-mono text-[11px] uppercase tracking-callsign",
          disabled ? "text-muted-faint" : "text-text group-hover:text-amber-glow",
        ].join(" ")}
      >
        {label}
      </span>
      {!disabled && (
        <span className="font-mono text-[10px] text-amber-deep group-hover:text-amber-glow">
          ▸
        </span>
      )}
    </button>
  );
}

function PrimaryAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-sm border border-amber-deep bg-amber-glow/[0.08] py-3 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm"
    >
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-amber-deep">
        ▸
      </span>
      {label}
      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-amber-deep">
        ▸
      </span>
    </button>
  );
}

function SecondaryAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-sm border border-ink-600 bg-ink-750 py-2.5 font-mono text-[11px] uppercase tracking-callsign text-muted transition-colors hover:border-amber-deep/70 hover:bg-amber-glow/[0.04] hover:text-amber-glow"
    >
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-faint group-hover:text-amber-deep">
        ▹
      </span>
      {label}
    </button>
  );
}

function AircraftDrawer({
  aircraft,
  data,
  onNavigate,
}: {
  aircraft: AtlasOwnedAircraft;
  data: AtlasData;
  onNavigate: (path: string) => void;
}) {
  const remaining = Math.max(
    0,
    aircraft.tboHours - aircraft.engineHoursSinceOverhaul,
  );

  // "Reachable jobs" = jobs whose distance fits the aircraft's range *and*
  // whose origin is the aircraft's current airport (you can fly your own
  // plane straight out of there). This matches the Job Board's "flyable
  // now" definition for this single aircraft.
  const RANGE_RESERVE_FACTOR = 1.15;
  const CLASS_RANK: Record<AtlasOwnedAircraft["aircraftClass"], number> = {
    SEP: 0,
    MEP: 1,
    SET: 2,
    JET: 3,
  };
  const acRank = CLASS_RANK[aircraft.aircraftClass];
  const reachableJobs = data.jobs.filter((j) => {
    if (j.originIcao !== aircraft.currentLocationIcao) return false;
    if (j.distanceNm * RANGE_RESERVE_FACTOR > aircraft.rangeNm) return false;
    const jobRank = CLASS_RANK[j.requiredClass];
    if (acRank < jobRank) return false;
    return true;
  });

  // Estimated endurance at cruise speed, ignoring climb/reserve — a quick
  // mental anchor for the player ("this is roughly how far one tank goes").
  const enduranceHours = aircraft.rangeNm / Math.max(1, aircraft.cruiseSpeedKts);

  return (
    <div className="flex flex-col gap-4">
      {/* Quick capability summary at top: rank, status, where it is, what
          it could fly right now. */}
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Type">{aircraft.aircraftTypeLabel}</Field>
          <Field label="Class" align="right">
            <span className="text-amber-glow">{aircraft.aircraftClass}</span>
          </Field>
          <Field label="Status">
            <span className={STATUS_TONE[aircraft.status]}>
              {STATUS_LABEL[aircraft.status]}
            </span>
          </Field>
          <Field label="Location" align="right">
            <span className="icao text-text-high">
              {aircraft.currentLocationIcao}
            </span>
          </Field>
        </div>
        <div className="mt-2 text-tiny text-muted-dim">
          {aircraft.currentLocationName}
        </div>
      </div>

      {/* Performance block — range and endurance pulled from the catalog
          (atlas.getData now ships these per owned aircraft). Players use
          these numbers to reason about which open jobs are flyable without
          a fuel stop. */}
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Performance</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Range">
            <span className="tabular-nums">
              {aircraft.rangeNm.toLocaleString()}{" "}
              <span className="text-muted">nm</span>
            </span>
          </Field>
          <Field label="Cruise" align="right">
            <span className="tabular-nums">
              {aircraft.cruiseSpeedKts}{" "}
              <span className="text-muted">kts</span>
            </span>
          </Field>
          <Field label="Endurance">
            <span className="tabular-nums">
              {enduranceHours.toFixed(1)} h
            </span>
            <span className="ml-1 text-muted-dim">@ cruise</span>
          </Field>
          <Field label="Fuel" align="right">
            <span className="text-text-high">
              {aircraft.fuelType === "jet-a" ? "Jet A" : "Avgas"}
            </span>
          </Field>
        </div>
      </div>

      {/* Reachable-jobs callout: the single most useful "next step" number
          for an aircraft drawer. Clicking jumps to the Job Board filtered to
          this airport so the player can pick one without re-finding it. */}
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Dispatch</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-3">
          <ActivityRow
            count={reachableJobs.length}
            label={`Jobs flyable from ${aircraft.currentLocationIcao}`}
            disabled={reachableJobs.length === 0}
            // No origin-filter consumer yet; jump to the board and let the
            // player flip the existing "At my location only" toggle.
            onClick={() => onNavigate(`/jobs`)}
          />
          {reachableJobs.length === 0 && aircraft.status === "available" && (
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
              No open jobs match this aircraft's range and class here
            </div>
          )}
        </div>
      </div>

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Hours</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Airframe">
            {aircraft.airframeHours.toFixed(1)} h
          </Field>
          <Field label="Engine remaining" align="right">
            {remaining.toFixed(0)} h
            <span className="ml-1 text-muted-dim">
              / {aircraft.tboHours} h TBO
            </span>
          </Field>
        </div>
      </div>

      <PrimaryAction
        label="View in Hangar"
        onClick={() => onNavigate(`/hangar?id=${aircraft.id}`)}
      />
    </div>
  );
}

function FlightDrawer({
  flight,
  onNavigate,
}: {
  flight: AtlasRecentFlight;
  onNavigate: (path: string) => void;
}) {
  const blockH = Math.floor(flight.blockTimeMinutes / 60);
  const blockM = flight.blockTimeMinutes % 60;
  const positive = flight.netCents >= 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="From">
            <span className="icao text-text-high">{flight.fromIcao}</span>
          </Field>
          <Field label="To" align="right">
            <span className="icao text-text-high">{flight.toIcao}</span>
          </Field>
          <Field label="Aircraft">{flight.aircraftLabel}</Field>
          <Field label="Block time" align="right">
            <span className="tabular-nums">
              {blockH}h {String(blockM).padStart(2, "0")}m
            </span>
          </Field>
          <Field label="Ended">
            <span className="tabular-nums">
              {formatSimDateTime(flight.endedAt)}
            </span>
          </Field>
          <Field label="Age" align="right">
            <span className="tabular-nums">
              {flight.ageDays.toFixed(1)} days ago
            </span>
          </Field>
        </div>
      </div>

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Net P&amp;L</span>
          <span
            className={[
              "font-mono text-[16px] tabular-nums",
              positive ? "text-emerald-300" : "text-urgency-critical",
            ].join(" ")}
          >
            {positive ? "+" : ""}
            {formatPay(flight.netCents)}
          </span>
        </div>
      </div>

      <PrimaryAction
        label="View in Logbook"
        onClick={() => onNavigate(`/logbook?flightId=${flight.id}`)}
      />
    </div>
  );
}

const URGENCY_TONE: Record<AtlasJob["urgency"], string> = {
  flexible: "border-ink-500 text-muted bg-ink-700",
  standard: "border-ink-500 text-muted bg-ink-700",
  urgent: "border-urgency-urgent/70 text-urgency-urgent bg-urgency-urgent/[0.07]",
  critical:
    "border-urgency-critical/70 text-urgency-critical bg-urgency-critical/[0.08]",
};

const WEATHER_LABEL: Record<AtlasJob["weatherSensitivity"], string> = {
  none: "All-weather",
  mild: "Mild",
  strict: "VFR · CAVOK",
};

function JobDrawer({
  job,
  data,
  onNavigate,
}: {
  job: AtlasJob;
  data: AtlasData;
  onNavigate: (path: string) => void;
}) {
  // The atlas-level AtlasJob already carries the headline fields (route,
  // pay, distance, urgency). We pull the richer JobDetail (payload, pax,
  // capabilities, window) lazily so the player gets enough info to decide
  // *without* navigating to the Job Board. The full acceptance flow still
  // lives there — this drawer is a glance + jump-off, not a clone.
  const detail = trpc.jobs.getById.useQuery(
    { id: job.id },
    { staleTime: 30_000 },
  );
  const d = detail.data ?? null;

  const truncated =
    job.description.length > 240
      ? job.description.slice(0, 240).trimEnd() + "…"
      : job.description;

  // Player is "at origin" when the career singleton sits at this job's
  // origin airport. We surface a tiny reachability hint so the player
  // doesn't have to mentally cross-check the position pulse.
  const isAtOrigin = data.player?.currentLocationIcao === job.originIcao;

  // Use sim time as the relative-time anchor where available; otherwise the
  // browser clock. The Job Board uses sim time too — keeping them aligned
  // matters when the player force-ticks.
  const simNow = data.player?.simDateTime ?? Date.now();

  return (
    <div className="flex flex-col gap-4">
      {/* Reachability hint — small, top of drawer. Mirrors the Job Board's
          reachability banner without dragging in the full eligibility
          pipeline; we only know "at origin or not" from atlas data. */}
      <div
        className={[
          "rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-callsign",
          isAtOrigin
            ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300"
            : "border-ink-600 bg-ink-750 text-muted",
        ].join(" ")}
      >
        {isAtOrigin
          ? "Departing from your location"
          : `Origin is ${job.originIcao} — you're at ${
              data.player?.currentLocationIcao ?? "—"
            }`}
      </div>

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-amber-deep/60 bg-amber-glow/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
            {ROLE_LABEL[job.role] ?? job.role}
          </span>
          <span
            className={[
              "rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign",
              URGENCY_TONE[job.urgency],
            ].join(" ")}
          >
            {job.urgency}
          </span>
          <span className="rounded-sm border border-ink-500 bg-ink-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted">
            min {job.requiredClass}
          </span>
          <span className="text-tiny text-muted">
            · {job.clientName ?? "Open Market"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="From">
            <span className="icao text-text-high">{job.originIcao}</span>
            <div className="mt-0.5 text-tiny text-muted-dim">
              {job.originName}
            </div>
          </Field>
          <Field label="To" align="right">
            <span className="icao text-text-high">{job.destinationIcao}</span>
            <div className="mt-0.5 text-tiny text-muted-dim">
              {job.destinationName}
            </div>
          </Field>
          <Field label="Distance">
            {job.distanceNm > 0 ? (
              <span className="tabular-nums">
                {job.distanceNm.toLocaleString()}{" "}
                <span className="text-muted">nm</span>
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Pay" align="right">
            <span className="text-amber-warm">{formatPay(job.pay)}</span>
          </Field>
          <Field label="Rate / nm">
            {job.distanceNm > 0 ? (
              <span className="tabular-nums text-amber-warm">
                ${(job.pay / 100 / job.distanceNm).toFixed(2)}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Weather" align="right">
            <span className="text-[11px] text-muted">
              {WEATHER_LABEL[job.weatherSensitivity]}
            </span>
          </Field>

          {/* JobDetail-sourced extras: payload + pax. Skip while loading
              rather than render a flicker of "—" the moment a drawer opens. */}
          {d && (
            <>
              <Field label="Payload">
                {d.payloadLbs > 0 ? (
                  <span>
                    {d.payloadLbs.toLocaleString()} lb
                    <span className="ml-1 text-muted">
                      · {formatPayloadType(d.payloadType)}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Pax" align="right">
                {d.paxCount ?? "—"}
              </Field>
            </>
          )}
        </div>

        {/* Capabilities row — only renders when the job demands something
            beyond a default rated aircraft (e.g. unpaved, floats). */}
        {d && d.requiredCapabilities.length > 0 && (
          <div className="mt-3 border-t border-ink-600/70 pt-3">
            <span className="label">Capabilities</span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {d.requiredCapabilities.map((c) => (
                <span
                  key={c}
                  className="rounded-sm border border-amber-deep/70 bg-amber-glow/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-glow"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expiry block — the urgent-by-time signal. Mirrors the Job Board
            drawer's coloring: red when the deadline is inside an hour, else
            neutral. simNow comes from the atlas dataset so it doesn't jump
            between this view and the board. */}
        {d && (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-ink-600/70 pt-3">
            <Field label="Generated">
              <span className="tabular-nums">
                {formatRelativeFromNow(d.generatedAt, simNow)} ago
              </span>
            </Field>
            <Field label="Expires" align="right">
              <span
                className={[
                  "tabular-nums",
                  d.expiresAt - simNow < 60 * 60 * 1000
                    ? "text-urgency-critical"
                    : "text-text-high",
                ].join(" ")}
              >
                in {formatRelativeFromNow(d.expiresAt, simNow)}
              </span>
            </Field>
            {(d.earliestDeparture || d.latestDeparture) && (
              <>
                <Field label="Earliest">
                  {d.earliestDeparture
                    ? formatSimDateTime(d.earliestDeparture)
                    : "Anytime"}
                </Field>
                <Field label="Latest" align="right">
                  {d.latestDeparture
                    ? formatSimDateTime(d.latestDeparture)
                    : "Anytime"}
                </Field>
              </>
            )}
          </div>
        )}
      </div>

      {truncated && (
        <div className="border-l-2 border-amber-deep/70 pl-3">
          <p className="text-[12px] leading-relaxed text-muted">{truncated}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <PrimaryAction
          label="Open in Job Board"
          onClick={() => onNavigate(`/jobs?jobId=${job.id}`)}
        />
        {!isAtOrigin && (
          <SecondaryAction
            label={`Travel to ${job.originIcao}`}
            onClick={() => onNavigate(`/jobs?travelTo=${job.originIcao}`)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function resolveTitle(
  feature: AtlasFeatureRef,
  data: AtlasData,
): { typeLabel: string; identifier: string; subtitle: string | null } {
  switch (feature.type) {
    case "airport": {
      const a = data.airports.find((x) => x.icao === feature.icao);
      return {
        typeLabel: "Airport",
        identifier: feature.icao,
        subtitle: a?.name ?? null,
      };
    }
    case "aircraft": {
      const a = data.ownedAircraft.find((x) => x.id === feature.id);
      return {
        typeLabel: "Aircraft",
        identifier: a?.tailNumber ?? `#${feature.id}`,
        subtitle: a?.aircraftTypeLabel ?? null,
      };
    }
    case "flight": {
      const f = data.recentFlights.find((x) => x.id === feature.id);
      return {
        typeLabel: "Flight",
        identifier: f ? `${f.fromIcao} → ${f.toIcao}` : `#${feature.id}`,
        subtitle: f?.aircraftLabel ?? null,
      };
    }
    case "job": {
      const j = data.jobs.find((x) => x.id === feature.id);
      return {
        typeLabel: "Job",
        identifier: `#${String(feature.id).padStart(5, "0")}`,
        subtitle: j?.clientName ?? "Open Market",
      };
    }
  }
}

export function FeatureDrawer({
  feature,
  data,
  onClose,
  onNavigate,
}: FeatureDrawerProps) {
  const open = feature != null && data != null;
  const title = open ? resolveTitle(feature, data) : null;

  let body: React.ReactNode = null;
  if (open) {
    switch (feature.type) {
      case "airport": {
        const a = data.airports.find((x) => x.icao === feature.icao);
        if (a) {
          body = <AirportDrawer airport={a} data={data} onNavigate={onNavigate} />;
        }
        break;
      }
      case "aircraft": {
        const a = data.ownedAircraft.find((x) => x.id === feature.id);
        if (a) {
          body = (
            <AircraftDrawer aircraft={a} data={data} onNavigate={onNavigate} />
          );
        }
        break;
      }
      case "flight": {
        const f = data.recentFlights.find((x) => x.id === feature.id);
        if (f) body = <FlightDrawer flight={f} onNavigate={onNavigate} />;
        break;
      }
      case "job": {
        const j = data.jobs.find((x) => x.id === feature.id);
        if (j) body = <JobDrawer job={j} data={data} onNavigate={onNavigate} />;
        break;
      }
    }
  }

  return (
    <aside
      className={[
        "absolute right-0 top-0 bottom-0 z-30 flex w-[380px] flex-col border-l border-ink-600 bg-ink-800 shadow-2xl",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

      <div className="flex items-start justify-between border-b border-ink-600 px-5 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            {title?.typeLabel ?? "—"}
          </div>
          <div className="font-display text-xl font-semibold tracking-tight text-text-high">
            {title?.identifier ?? "—"}
          </div>
          {title?.subtitle && (
            <div className="text-tiny text-muted">{title.subtitle}</div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
        {body ?? (
          <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
            no detail available
          </div>
        )}
      </div>
    </aside>
  );
}
