import type {
  AtlasJobClassFilter,
  AtlasJobColorBy,
  AtlasJobFilters,
} from "../../components/map/AtlasMap.js";

const CLASS_OPTIONS: AtlasJobClassFilter[] = ["any", "SEP", "MEP", "SET", "JET"];

const DISTANCE_MIN = 0;
const DISTANCE_MAX = 800;

interface JobsFilterPanelProps {
  filters: AtlasJobFilters;
  onChange: (next: AtlasJobFilters) => void;
  visibleJobs: number;
  totalJobs: number;
  recentFlightsAutoDisabled: boolean;
  onUndoAutoDisable: () => void;
  // Color encoding for job lines. FIT ("can I fly it") or $/NM ("is it
  // worth it") — the two questions that drive picking a job.
  colorBy: AtlasJobColorBy;
  onColorByChange: (next: AtlasJobColorBy) => void;
  fitDataLoading: boolean;
}

function ColorByChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  // Slightly heavier visual than ClassChip — the encoding switch is a
  // bigger commitment than a filter toggle, and the active state should
  // look more like a radio button than a sub-filter.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex-1 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-callsign transition-colors",
        active
          ? "border-amber-deep bg-amber-glow/[0.12] text-amber-glow shadow-[0_0_8px_rgba(212,165,116,0.18)]"
          : "border-ink-600 bg-ink-750 text-muted hover:border-amber-deep/60 hover:text-amber-glow",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ClassChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-callsign transition-colors",
        active
          ? "border-amber-deep bg-amber-glow/[0.10] text-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.18)]"
          : "border-ink-600 bg-ink-750 text-muted hover:border-amber-deep/60 hover:text-amber-glow",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// A compact dual-handle range using two stacked sliders. Handles never cross
// because we clamp on change.
function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: { min: number; max: number };
  min: number;
  max: number;
  step: number;
  onChange: (v: { min: number; max: number }) => void;
}) {
  const span = max - min;
  const lo = ((value.min - min) / span) * 100;
  const hi = ((value.max - min) / span) * 100;

  return (
    <div className="relative h-7 w-full">
      {/* Track */}
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-ink-600" />
      {/* Active span */}
      <div
        className="absolute top-1/2 h-px -translate-y-1/2 bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.5)]"
        style={{ left: `${lo}%`, right: `${100 - hi}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value.min}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), value.max - step);
          onChange({ min: v, max: value.max });
        }}
        className="atlas-range pointer-events-auto absolute inset-0 appearance-none bg-transparent"
        aria-label="Min distance"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value.max}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), value.min + step);
          onChange({ min: value.min, max: v });
        }}
        className="atlas-range pointer-events-auto absolute inset-0 appearance-none bg-transparent"
        aria-label="Max distance"
      />
    </div>
  );
}

export function JobsFilterPanel({
  filters,
  onChange,
  visibleJobs,
  totalJobs,
  recentFlightsAutoDisabled,
  onUndoAutoDisable,
  colorBy,
  onColorByChange,
  fitDataLoading,
}: JobsFilterPanelProps) {
  const toggleClass = (c: AtlasJobClassFilter) => {
    if (c === "any") {
      onChange({ ...filters, classes: ["any"] });
      return;
    }
    const without = filters.classes.filter((x) => x !== "any" && x !== c);
    const has = filters.classes.includes(c);
    const next = has ? without : [...without, c];
    onChange({ ...filters, classes: next.length === 0 ? ["any"] : next });
  };

  const isClassActive = (c: AtlasJobClassFilter) => {
    if (c === "any")
      return filters.classes.length === 0 || filters.classes.includes("any");
    return filters.classes.includes(c);
  };

  const filtersActive =
    filters.distanceNm.min > DISTANCE_MIN ||
    filters.distanceNm.max < DISTANCE_MAX ||
    (filters.classes.length > 0 && !filters.classes.includes("any"));

  const reset = () =>
    onChange({
      distanceNm: { min: DISTANCE_MIN, max: DISTANCE_MAX },
      classes: ["any"],
    });

  return (
    <div className="border-b border-ink-600 bg-ink-800/80 px-4 pt-4 pb-4">
      {/* Color encoding selector. Sits above the filter chips because it
          changes what every job line *means* — bigger semantic shift than
          which jobs are visible. */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label">Color by</span>
          {fitDataLoading && (
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
              loading fit…
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["fit", "rate"] as const).map((mode) => (
            <ColorByChip
              key={mode}
              label={mode === "rate" ? "$ / NM" : mode.toUpperCase()}
              active={colorBy === mode}
              onClick={() => onColorByChange(mode)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="label">Jobs filter</span>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          <span
            className={
              filtersActive ? "text-amber-glow" : "text-muted-faint"
            }
          >
            {String(visibleJobs).padStart(2, "0")}
          </span>{" "}
          / {String(totalJobs).padStart(2, "0")}
        </span>
      </div>

      {/* Distance */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-callsign">
          <span className="text-muted-faint">Distance</span>
          <span className="tabular-nums text-text">
            {filters.distanceNm.min}–{filters.distanceNm.max}
            <span className="ml-1 text-muted-faint">nm</span>
          </span>
        </div>
        <RangeSlider
          min={DISTANCE_MIN}
          max={DISTANCE_MAX}
          step={10}
          value={filters.distanceNm}
          onChange={(distanceNm) => onChange({ ...filters, distanceNm })}
        />
      </div>

      {/* Class */}
      <div className="mt-2">
        <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          Min class
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {CLASS_OPTIONS.map((c) => (
            <ClassChip
              key={c}
              active={isClassActive(c)}
              label={c === "any" ? "Any" : c}
              onClick={() => toggleClass(c)}
            />
          ))}
        </div>
      </div>

      {filtersActive && (
        <button
          type="button"
          onClick={reset}
          className="mt-3 w-full rounded-sm border border-ink-600 bg-ink-750 py-1 font-mono text-[10px] uppercase tracking-callsign text-muted hover:border-amber-deep/70 hover:text-amber-glow"
        >
          Reset filters
        </button>
      )}

      {recentFlightsAutoDisabled && (
        <div className="mt-3 rounded-sm border border-ink-600 bg-ink-750/70 px-2.5 py-1.5">
          <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-callsign">
            <span className="text-muted-faint">
              Recent flights hidden while jobs active
            </span>
            <button
              type="button"
              onClick={onUndoAutoDisable}
              className="text-amber-glow hover:text-amber-warm"
            >
              show
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
