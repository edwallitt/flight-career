import type { FleetReadout } from "./types.js";

// Thin strip that lives above the JobFilters row. Surfaces the player's
// dispatchable fleet (owned at current airport + rentals here) so they can
// scan the board without holding payload/range/cls in their head.
//
// Layout invariants worth knowing about:
//  - Each chip is single-line (whitespace-nowrap + flex-shrink-0). Without
//    these the inner text spans wrap at small widths and chips balloon to
//    100+ px tall, which used to squash the job table to a tiny panel.
//  - The outer flex row wraps (flex-wrap) so many chips spill onto a second
//    row instead of overflowing off the right edge into <main>'s
//    overflow-hidden clip.
//  - Each group caps visible chips at MAX_CHIPS_PER_GROUP with an "+N more"
//    tag so a player with a dozen rentals at one airport doesn't get a
//    multi-row banner. The Hangar is the place to see everything.

const MAX_CHIPS_PER_GROUP = 5;

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

  const ownedVisible = fleet.ownedHere.slice(0, MAX_CHIPS_PER_GROUP);
  const ownedHidden = fleet.ownedHere.length - ownedVisible.length;
  const rentalsVisible = fleet.rentalsHere.slice(0, MAX_CHIPS_PER_GROUP);
  const rentalsHidden = fleet.rentalsHere.length - rentalsVisible.length;

  return (
    <section
      aria-label="Dispatchable fleet at current airport"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-700/70 bg-ink-850/70 px-6 py-2 text-tiny"
    >
      <h2 className="flex shrink-0 items-center gap-2 font-mono uppercase tracking-callsign text-amber-deep">
        <span className="h-1 w-1 rounded-full bg-amber-deep" aria-hidden />
        <span className="text-[10px]">Fleet @</span>
        <span className="icao text-amber-glow">
          {playerLocationIcao || "—"}
        </span>
      </h2>

      {hasOwnedHere && (
        <div className="flex flex-wrap items-center gap-2">
          {ownedVisible.map((a) => (
            <AircraftChip
              key={`o-${a.tailNumber}`}
              tone="owned"
              tail={a.tailNumber}
              model={`${a.manufacturer} ${a.model}`}
              cls={a.cls}
              maxPayloadLbs={a.maxPayloadLbs}
              rangeNm={a.rangeNm}
              cruiseSpeedKts={a.cruiseSpeedKts}
            />
          ))}
          {ownedHidden > 0 && <OverflowTag count={ownedHidden} tone="owned" />}
        </div>
      )}

      {hasRentals && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint"
            aria-hidden
          >
            Rentals
          </span>
          {rentalsVisible.map((a) => (
            <AircraftChip
              key={`r-${a.aircraftTypeId}`}
              tone="rental"
              tail={null}
              model={`${a.manufacturer} ${a.model}`}
              cls={a.cls}
              maxPayloadLbs={a.maxPayloadLbs}
              rangeNm={a.rangeNm}
              cruiseSpeedKts={a.cruiseSpeedKts}
              rentalRatePerHour={a.rentalRatePerHour}
            />
          ))}
          {rentalsHidden > 0 && (
            <OverflowTag count={rentalsHidden} tone="rental" />
          )}
        </div>
      )}

      {fleet.ownedElsewhere > 0 && (
        <div className="shrink-0 font-mono text-[11px] uppercase tracking-callsign text-muted">
          + {fleet.ownedElsewhere} owned elsewhere
        </div>
      )}
    </section>
  );
}

function AircraftChip({
  tone,
  tail,
  model,
  cls,
  maxPayloadLbs,
  rangeNm,
  cruiseSpeedKts,
  rentalRatePerHour,
}: {
  tone: "owned" | "rental";
  tail: string | null;
  model: string;
  cls: string;
  maxPayloadLbs: number;
  rangeNm: number;
  cruiseSpeedKts: number;
  rentalRatePerHour?: number;
}) {
  const lead = tail ?? model;
  const rentalSuffix =
    rentalRatePerHour != null
      ? ` · $${Math.round(rentalRatePerHour / 100)}/hr`
      : "";
  const ariaLabel = `${tone === "owned" ? "Owned" : "Rental"} ${cls} ${model}${
    tail ? ` (tail ${tail})` : ""
  }: ${maxPayloadLbs.toLocaleString()} pounds payload, ${rangeNm.toLocaleString()} nautical mile range, ${cruiseSpeedKts} knot cruise${rentalSuffix}`;
  return (
    <span
      title={`${model}${tail ? ` · ${tail}` : ""}${rentalSuffix}`}
      aria-label={ariaLabel}
      className={[
        "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border bg-ink-800/80 px-2 py-1 font-mono text-[11px] tabular-nums",
        tone === "owned"
          ? "border-amber-deep/60 text-amber-glow"
          : "border-sky-500/40 text-sky-300",
      ].join(" ")}
    >
      <span
        className="text-[10px] uppercase tracking-callsign text-muted-dim"
        aria-hidden
      >
        {cls}
      </span>
      <span className="text-text-high" aria-hidden>
        {lead}
      </span>
      <span className="text-muted-dim" aria-hidden>
        {maxPayloadLbs.toLocaleString()}lb · {rangeNm.toLocaleString()}nm
      </span>
    </span>
  );
}

function OverflowTag({
  count,
  tone,
}: {
  count: number;
  tone: "owned" | "rental";
}) {
  return (
    <span
      aria-label={`${count} more ${tone === "owned" ? "owned" : "rental"} aircraft not shown`}
      className={[
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border border-dashed bg-transparent px-2 py-1 font-mono text-[11px] tabular-nums",
        tone === "owned"
          ? "border-amber-deep/40 text-amber-deep"
          : "border-sky-500/30 text-sky-400/80",
      ].join(" ")}
    >
      + {count} more
    </span>
  );
}
