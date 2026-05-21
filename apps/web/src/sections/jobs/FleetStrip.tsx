import type { FleetReadout } from "./types.js";

// Thin strip that lives above the JobFilters row. Surfaces the player's
// dispatchable fleet (owned at current airport + rentals here) so they can
// scan the board without holding payload/range/cls in their head.

export function FleetStrip({
  fleet,
  playerLocationIcao,
}: {
  fleet: FleetReadout;
  playerLocationIcao: string;
}) {
  const hasOwnedHere = fleet.ownedHere.length > 0;
  const hasRentals = fleet.rentalsHere.length > 0;
  if (!hasOwnedHere && !hasRentals && fleet.ownedElsewhere === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-6 border-b border-ink-700/70 bg-ink-850/70 px-6 py-2.5 text-tiny">
      <div className="flex items-center gap-2 font-mono uppercase tracking-callsign text-amber-deep">
        <span className="h-1 w-1 rounded-full bg-amber-deep" />
        Fleet @ <span className="icao text-amber-glow">{playerLocationIcao || "—"}</span>
      </div>

      {hasOwnedHere && (
        <div className="flex items-center gap-3">
          {fleet.ownedHere.map((a) => (
            <AircraftChip
              key={`o-${a.tailNumber}`}
              tone="owned"
              title={`${a.tailNumber} · ${a.manufacturer} ${a.model}`}
              cls={a.cls}
              maxPayloadLbs={a.maxPayloadLbs}
              rangeNm={a.rangeNm}
              cruiseSpeedKts={a.cruiseSpeedKts}
            />
          ))}
        </div>
      )}

      {hasRentals && (
        <>
          <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
            Rentals
          </span>
          <div className="flex items-center gap-3">
            {fleet.rentalsHere.map((a) => (
              <AircraftChip
                key={`r-${a.aircraftTypeId}`}
                tone="rental"
                title={`${a.manufacturer} ${a.model} · $${Math.round(
                  a.rentalRatePerHour / 100,
                )}/hr`}
                cls={a.cls}
                maxPayloadLbs={a.maxPayloadLbs}
                rangeNm={a.rangeNm}
                cruiseSpeedKts={a.cruiseSpeedKts}
              />
            ))}
          </div>
        </>
      )}

      {fleet.ownedElsewhere > 0 && (
        <div className="ml-auto font-mono text-[11px] uppercase tracking-callsign text-muted">
          + {fleet.ownedElsewhere} owned elsewhere
        </div>
      )}
    </div>
  );
}

function AircraftChip({
  tone,
  title,
  cls,
  maxPayloadLbs,
  rangeNm,
  cruiseSpeedKts,
}: {
  tone: "owned" | "rental";
  title: string;
  cls: string;
  maxPayloadLbs: number;
  rangeNm: number;
  cruiseSpeedKts: number;
}) {
  return (
    <span
      title={title}
      className={[
        "inline-flex items-center gap-2 rounded-sm border bg-ink-800/80 px-2 py-1 font-mono text-[11px] tabular-nums",
        tone === "owned"
          ? "border-amber-deep/60 text-amber-glow"
          : "border-sky-500/40 text-sky-300",
      ].join(" ")}
    >
      <span className="text-[10px] uppercase tracking-callsign text-muted-dim">
        {cls}
      </span>
      <span className="text-text-high">{title.split(" · ")[0]}</span>
      <span className="text-muted-dim">
        {maxPayloadLbs.toLocaleString()} lb · {rangeNm.toLocaleString()} nm ·{" "}
        {cruiseSpeedKts} kt
      </span>
    </span>
  );
}
