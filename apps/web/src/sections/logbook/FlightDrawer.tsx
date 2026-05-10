import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";
import {
  RouteMap,
  type MapAirport,
  type MapRoute,
} from "../../components/map/RouteMap.js";

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

function formatBlock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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
      <span className="font-mono text-[13px] text-text-high">{children}</span>
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  completed: "border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-300",
  diverted: "border-urgency-urgent/60 bg-urgency-urgent/[0.10] text-urgency-urgent",
  failed: "border-urgency-critical/60 bg-urgency-critical/[0.10] text-urgency-critical",
};

export function FlightDrawer({
  flightId,
  onClose,
}: {
  flightId: number | null;
  onClose: () => void;
}) {
  const detail = trpc.logbook.flightById.useQuery(
    { id: flightId ?? -1 },
    { enabled: flightId != null },
  );

  const open = flightId != null;
  const flight = detail.data;
  const net = flight ? flight.totalRevenue - flight.totalCost : 0;

  return (
    <aside
      className={[
        "absolute right-0 top-0 bottom-0 z-30 flex w-[460px] flex-col border-l border-ink-600 bg-ink-800 shadow-2xl",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

      {/* Header — route + headline net */}
      <div className="flex items-start justify-between border-b border-ink-600 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Flight · #{String(flightId ?? "").padStart(5, "0")}
          </div>
          {flight && (
            <>
              <div className="flex items-baseline gap-2">
                <span className="icao text-2xl text-text-high">
                  {flight.originIcao}
                </span>
                <span className="text-amber-deep">→</span>
                <span className="icao text-2xl text-text-high">
                  {flight.destinationIcao}
                </span>
                {flight.isDiversion && (
                  <span className="ml-1 rounded-sm border border-urgency-urgent/60 bg-urgency-urgent/[0.10] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-urgency-urgent">
                    DIV
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-callsign">
                <span className="text-muted-dim">
                  {flight.clientName ?? "—"}
                </span>
                <span className="text-muted-faint">·</span>
                <span
                  className={
                    net >= 0 ? "text-emerald-300" : "text-urgency-critical"
                  }
                >
                  net {net >= 0 ? "+" : "−"}
                  {formatCash(Math.abs(net))}
                </span>
              </div>
            </>
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

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {!flight ? (
          <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
            {detail.isPending ? "loading…" : "no flight selected"}
          </div>
        ) : (
          <>
            {/* Route detail */}
            <div className="flex flex-col gap-3 rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="label">From</span>
                  <span className="icao text-[18px] font-medium text-text-high">
                    {flight.originIcao}
                  </span>
                  <span className="mt-0.5 text-tiny text-muted-dim">
                    {flight.originName}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="label">To</span>
                  <span className="icao text-[18px] font-medium text-text-high">
                    {flight.destinationIcao}
                  </span>
                  <span className="mt-0.5 text-right text-tiny text-muted-dim">
                    {flight.destinationName}
                  </span>
                </div>
              </div>

              {flight.originLat != null &&
              flight.originLon != null &&
              flight.destinationLat != null &&
              flight.destinationLon != null ? (
                <RouteMap
                  height={180}
                  paddingPx={28}
                  airports={buildLogbookAirports(flight)}
                  routes={buildLogbookRoutes(flight)}
                />
              ) : null}

              {flight.isDiversion && flight.plannedDestinationIcao && (
                <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                  <span>
                    Planned ·{" "}
                    <span className="icao text-muted">
                      {flight.plannedDestinationIcao}
                    </span>
                  </span>
                  <span className="italic text-muted">ghost route shown</span>
                </div>
              )}
            </div>

            {flight.dispatcherSignoff && (
              <div className="rounded-sm border-l-2 border-amber-deep/70 bg-ink-750 px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  Dispatcher sign-off
                </div>
                <p className="mt-2 font-display text-[13px] italic leading-relaxed text-text-high">
                  &ldquo;{flight.dispatcherSignoff.message}&rdquo;
                </p>
                {(() => {
                  const s = flight.dispatcherSignoff;
                  const byline =
                    s.dispatcherName && s.sourceLabel
                      ? `${s.dispatcherName}, ${s.sourceLabel}`
                      : s.dispatcherName ?? s.sourceLabel ?? null;
                  return byline ? (
                    <div className="mt-2 font-mono text-tiny text-muted">
                      — {byline}
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-sm border border-ink-600 bg-ink-750 p-4">
              <Field label="Departed">
                <span className="tabular-nums">
                  {formatSimDateTime(flight.startedAt)}
                </span>
              </Field>
              <Field label="Arrived" align="right">
                <span className="tabular-nums">
                  {formatSimDateTime(flight.endedAt)}
                </span>
              </Field>

              <Field label="Block time">
                <span className="tabular-nums">
                  {formatBlock(flight.blockTimeMinutes)}
                </span>
              </Field>
              <Field label="Fuel burned" align="right">
                <span className="tabular-nums">
                  {flight.fuelBurnedGal.toFixed(1)} gal
                </span>
              </Field>

              <Field label="Aircraft">{flight.aircraftLabel}</Field>
              <Field label="Class" align="right">
                <span className="text-amber-glow">{flight.aircraftClass}</span>
              </Field>

              <Field label="Client">{flight.clientName ?? "—"}</Field>
              <Field label="Outcome" align="right">
                <span
                  className={[
                    "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign",
                    OUTCOME_TONE[flight.outcome] ??
                      "border-ink-500 bg-ink-700 text-muted",
                  ].join(" ")}
                >
                  {flight.outcome}
                </span>
              </Field>
            </div>

            {/* Financial breakdown */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center gap-2">
                <span className="label">Financials</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 font-mono text-[12px]">
                <LedgerLine
                  label="Revenue"
                  value={`+${formatCash(flight.totalRevenue)}`}
                  tone="positive"
                />
                <LedgerLine
                  label={
                    flight.aircraftSource === "rental"
                      ? "Costs (fuel · landing · rental)"
                      : "Costs (fuel · landing · refuel)"
                  }
                  value={`−${formatCash(flight.totalCost)}`}
                  tone="negative"
                />
                <li className="mt-2 flex items-baseline justify-between border-t border-ink-600 pt-2">
                  <span className="uppercase tracking-callsign text-muted-dim">
                    Net
                  </span>
                  <span
                    className={[
                      "tabular-nums",
                      net >= 0 ? "text-emerald-300" : "text-urgency-critical",
                    ].join(" ")}
                  >
                    {net >= 0 ? "+" : "−"}
                    {formatCash(Math.abs(net))}
                  </span>
                </li>
              </ul>
            </div>

            {flight.notes && (
              <div className="rounded-sm border-l-2 border-amber-deep/70 bg-ink-750 px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                  Notes
                </div>
                <p className="mt-1 text-tiny leading-relaxed text-text">
                  {flight.notes}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

interface FlightLike {
  originIcao: string;
  destinationIcao: string;
  originLat: number | null;
  originLon: number | null;
  destinationLat: number | null;
  destinationLon: number | null;
  isDiversion: boolean;
  plannedDestinationIcao: string | null;
  plannedDestinationLat: number | null;
  plannedDestinationLon: number | null;
}

function buildLogbookAirports(flight: FlightLike): MapAirport[] {
  const aps: MapAirport[] = [];
  if (flight.originLat != null && flight.originLon != null) {
    aps.push({
      icao: flight.originIcao,
      lat: flight.originLat,
      lon: flight.originLon,
      label: flight.originIcao,
      marker: "origin",
    });
  }
  if (flight.destinationLat != null && flight.destinationLon != null) {
    aps.push({
      icao: flight.destinationIcao,
      lat: flight.destinationLat,
      lon: flight.destinationLon,
      label: flight.destinationIcao,
      marker: "destination",
    });
  }
  if (
    flight.isDiversion &&
    flight.plannedDestinationIcao &&
    flight.plannedDestinationLat != null &&
    flight.plannedDestinationLon != null
  ) {
    aps.push({
      icao: flight.plannedDestinationIcao,
      lat: flight.plannedDestinationLat,
      lon: flight.plannedDestinationLon,
      label: `${flight.plannedDestinationIcao} · planned`,
      marker: "destination",
    });
  }
  return aps;
}

function buildLogbookRoutes(flight: FlightLike): MapRoute[] {
  const routes: MapRoute[] = [
    {
      fromIcao: flight.originIcao,
      toIcao: flight.destinationIcao,
      style: "solid",
      tone: "primary",
    },
  ];
  if (
    flight.isDiversion &&
    flight.plannedDestinationIcao &&
    flight.plannedDestinationIcao !== flight.destinationIcao
  ) {
    routes.push({
      fromIcao: flight.originIcao,
      toIcao: flight.plannedDestinationIcao,
      style: "dashed",
      tone: "ghost",
    });
  }
  return routes;
}

function LedgerLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-300" : "text-urgency-critical";
  return (
    <li className="flex items-baseline gap-2">
      <span className="text-muted">· {label}</span>
      <span
        aria-hidden
        className="mx-1 mb-1 flex-1 border-b border-dotted border-ink-600/80"
      />
      <span className={`tabular-nums ${toneClass}`}>{value}</span>
    </li>
  );
}
