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
  formatSimDateTime,
  ROLE_LABEL,
} from "../../lib/formatters.js";

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

function formatFuelPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}/gal`;
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

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Fuel</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <Field label="Avgas">{formatFuelPrice(airport.fuelPriceAvgas)}</Field>
          <Field label="Jet A" align="right">
            {formatFuelPrice(airport.fuelPriceJetA)}
          </Field>
        </div>
      </div>

      <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
        <div className="flex items-center gap-2">
          <span className="label">Activity</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 font-mono text-[12px] text-muted">
          {isHere && (
            <li className="text-emerald-300">▸ You're here</li>
          )}
          {ownedHere.length > 0 && (
            <li>
              ▸ {ownedHere.length} of your aircraft here
            </li>
          )}
          {jobsFromHere.length > 0 && (
            <li>▸ {jobsFromHere.length} open jobs from here</li>
          )}
          {!isHere && ownedHere.length === 0 && jobsFromHere.length === 0 && (
            <li className="text-muted-dim">No current activity</li>
          )}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        {!isHere && (
          <PrimaryAction
            label="Travel here"
            onClick={() => onNavigate(`/jobs?travelTo=${airport.icao}`)}
          />
        )}
        <SecondaryAction
          label="View jobs from here"
          onClick={() => onNavigate(`/jobs?origin=${airport.icao}`)}
        />
      </div>
    </div>
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
  onNavigate,
}: {
  aircraft: AtlasOwnedAircraft;
  onNavigate: (path: string) => void;
}) {
  const remaining = Math.max(
    0,
    aircraft.tboHours - aircraft.engineHoursSinceOverhaul,
  );

  return (
    <div className="flex flex-col gap-4">
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
  onNavigate,
}: {
  job: AtlasJob;
  onNavigate: (path: string) => void;
}) {
  const truncated =
    job.description.length > 240
      ? job.description.slice(0, 240).trimEnd() + "…"
      : job.description;

  return (
    <div className="flex flex-col gap-4">
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
        </div>
      </div>

      {truncated && (
        <div className="border-l-2 border-amber-deep/70 pl-3">
          <p className="text-[12px] leading-relaxed text-muted">{truncated}</p>
        </div>
      )}

      <PrimaryAction
        label="View in Job Board"
        onClick={() => onNavigate(`/jobs?jobId=${job.id}`)}
      />
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
        if (a)
          body = <AirportDrawer airport={a} data={data} onNavigate={onNavigate} />;
        break;
      }
      case "aircraft": {
        const a = data.ownedAircraft.find((x) => x.id === feature.id);
        if (a) body = <AircraftDrawer aircraft={a} onNavigate={onNavigate} />;
        break;
      }
      case "flight": {
        const f = data.recentFlights.find((x) => x.id === feature.id);
        if (f) body = <FlightDrawer flight={f} onNavigate={onNavigate} />;
        break;
      }
      case "job": {
        const j = data.jobs.find((x) => x.id === feature.id);
        if (j) body = <JobDrawer job={j} onNavigate={onNavigate} />;
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
