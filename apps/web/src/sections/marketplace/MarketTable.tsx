import { formatCash } from "../../lib/formatters.js";
import {
  ENGINE_TONE_CLASS,
  getEngineHealthTone,
} from "../../lib/engineHealth.js";
import type { Listing } from "./types.js";

const CONDITION_TONE: Record<string, string> = {
  pristine: "text-emerald-300",
  excellent: "text-sky-300",
  good: "text-text-high",
  fair: "text-amber-glow",
  project: "text-urgency-urgent",
};

const GRID_TEMPLATE =
  "minmax(220px, 1.4fr) 110px minmax(180px, 1fr) 90px 110px 130px 110px 130px";

function HeaderRow() {
  const cols: { label: string; align?: "right" | "center" }[] = [
    { label: "Aircraft" },
    { label: "Tail" },
    { label: "Location" },
    { label: "Dist", align: "right" },
    { label: "Hours", align: "right" },
    { label: "Engine", align: "right" },
    { label: "Cond.", align: "center" },
    { label: "Price", align: "right" },
  ];
  return (
    <div
      className="grid border-b border-ink-600 bg-ink-800 px-6 py-2.5"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      {cols.map((c) => (
        <span
          key={c.label}
          className={[
            "font-mono text-[10px] uppercase tracking-callsign text-muted-dim",
            c.align === "right" && "text-right",
            c.align === "center" && "text-center",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function MarketTable({
  listings,
  selectedId,
  onSelect,
  isLoading,
}: {
  listings: Listing[];
  selectedId: number | null;
  onSelect: (l: Listing) => void;
  isLoading: boolean;
}) {
  if (!isLoading && listings.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
            market · empty
          </div>
          <div className="font-display text-2xl font-semibold tracking-tight text-text-high">
            No listings match your filters
          </div>
          <div className="text-sm text-muted">
            Adjust the filters above, or refresh listings to top up the
            marketplace.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HeaderRow />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listings.map((l, idx) => {
          const selected = selectedId === l.id;
          const engineTone = getEngineHealthTone(
            l.engineHoursSinceOverhaul,
            l.tboHours,
          );
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelect(l)}
              className={[
                "group relative grid w-full items-center px-6 py-2.5 text-left transition-colors",
                "border-b border-ink-700/60",
                selected
                  ? "bg-amber-glow/[0.05]"
                  : idx % 2 === 0
                    ? "bg-transparent hover:bg-ink-700/40"
                    : "bg-ink-800/30 hover:bg-ink-700/40",
              ].join(" ")}
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              <span
                className={[
                  "pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] transition-all",
                  selected ? "bg-amber-glow" : "bg-transparent",
                ].join(" ")}
              />

              {/* Aircraft */}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-text-high">
                  {l.aircraftTypeManufacturer} {l.aircraftTypeModel}
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
                  {l.aircraftClass}
                </span>
              </div>

              {/* Tail */}
              <div className="font-mono text-[13px] text-text-high">
                {l.tailNumber}
              </div>

              {/* Location */}
              <div className="flex min-w-0 flex-col">
                <span className="icao text-sm">{l.locationIcao}</span>
                <span className="mt-0.5 truncate text-tiny text-muted-dim">
                  {l.locationName}
                </span>
              </div>

              {/* Distance */}
              <div className="text-right font-mono tabular-nums text-[13px] text-text-high">
                {l.distanceFromPlayerNm == null ? (
                  <span className="text-muted-dim">—</span>
                ) : l.distanceFromPlayerNm === 0 ? (
                  <span className="text-emerald-300">here</span>
                ) : (
                  <>
                    {l.distanceFromPlayerNm.toLocaleString()}
                    <span className="ml-1 text-muted-dim">nm</span>
                  </>
                )}
              </div>

              {/* Hours */}
              <div className="text-right font-mono tabular-nums text-[13px] text-text-high">
                {Math.round(l.airframeHours).toLocaleString()}
              </div>

              {/* Engine */}
              <div className="text-right font-mono tabular-nums text-[13px]">
                <span className={ENGINE_TONE_CLASS[engineTone]}>
                  {Math.round(l.engineHoursSinceOverhaul).toLocaleString()}
                </span>
                <span className="text-muted-dim">
                  {" "}
                  / {l.tboHours.toLocaleString()}
                </span>
              </div>

              {/* Condition */}
              <div className="text-center">
                <span
                  className={[
                    "font-mono text-[11px] uppercase tracking-callsign",
                    CONDITION_TONE[l.conditionGrade] ?? "text-muted",
                  ].join(" ")}
                >
                  {l.conditionGrade}
                </span>
              </div>

              {/* Price */}
              <div className="text-right">
                <span className="font-mono tabular-nums text-[14px] font-medium text-amber-warm">
                  {formatCash(l.askingPriceCents)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
