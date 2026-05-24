import type { OriginScope, RoleFilter } from "./types.js";

// Five real career-track roles. Ferry contracts (`jobType: "ferry"`, not a
// distinct role) always show through — they're visually tagged in the row
// and are too opportunistic to gate behind their own filter button.
const ROLES: { id: RoleFilter; label: string; code: string }[] = [
  { id: "all", label: "All", code: "ALL" },
  { id: "bush", label: "Bush", code: "BSH" },
  { id: "air_taxi", label: "Air Taxi", code: "ATX" },
  { id: "light_jet", label: "Light Jet", code: "LJT" },
  { id: "open", label: "Open Market", code: "OPN" },
];

// Origin scope replaces what used to be two booleans (flyable-only +
// at-my-location-only). They were always on the same axis — "how much
// repositioning am I willing to do?" — and modelling them separately let
// players land on contradictory combinations.
//
// Default lives in JobBoard (currently "flyable"); the segmented control
// here just exposes the dial.
const ORIGIN_SCOPES: {
  id: OriginScope;
  label: (icao: string) => string;
  title: (icao: string) => string;
}[] = [
  {
    id: "here",
    label: (icao) => `At ${icao || "—"}`,
    title: (icao) =>
      icao
        ? `Only jobs departing from ${icao}. Zero repositioning.`
        : "Player location unknown",
  },
  {
    id: "flyable",
    label: () => "Flyable",
    title: () =>
      "Jobs an aircraft you can dispatch right now (owned or rentable) actually fits — payload, range, capability. Includes short repositions.",
  },
  {
    id: "all",
    label: () => "All",
    title: () =>
      "Show every job on the board, including ones your current fleet can't satisfy. Useful for spotting upgrade targets.",
  },
];

export function JobFilters({
  roleFilter,
  setRoleFilter,
  originScope,
  setOriginScope,
  playerLocationIcao,
  totalCount,
  filteredCount,
  onTickNow,
  isTicking,
  lastTick,
}: {
  roleFilter: RoleFilter;
  setRoleFilter: (r: RoleFilter) => void;
  originScope: OriginScope;
  setOriginScope: (s: OriginScope) => void;
  playerLocationIcao: string;
  totalCount: number;
  filteredCount: number;
  onTickNow: () => void;
  isTicking: boolean;
  lastTick?: { inserted: number; expired: number };
}) {
  const isDev =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("dev") === "1";

  return (
    <div className="flex items-stretch gap-6 border-b border-ink-600 bg-ink-800/40 px-6 py-3">
      {/* Origin scope — primary dial */}
      <div className="flex flex-col gap-1.5">
        <span className="label">Origin</span>
        <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
          {ORIGIN_SCOPES.map((s) => {
            const active = originScope === s.id;
            const disabled = s.id === "here" && !playerLocationIcao;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => !disabled && setOriginScope(s.id)}
                disabled={disabled}
                title={s.title(playerLocationIcao)}
                aria-pressed={active}
                className={[
                  "relative px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign transition-colors disabled:opacity-40",
                  active
                    ? "text-text-high"
                    : "text-muted-dim hover:text-text",
                ].join(" ")}
              >
                {active && (
                  <span className="absolute inset-0 rounded-sm bg-amber-glow/[0.07] ring-1 ring-amber-deep/60" />
                )}
                <span className="relative">{s.label(playerLocationIcao)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Role filter — five career-track roles, ferry is always-visible */}
      <div className="flex flex-col gap-1.5">
        <span className="label">Role</span>
        <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
          {ROLES.map((r) => {
            const active = roleFilter === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRoleFilter(r.id)}
                aria-pressed={active}
                className={[
                  "relative px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                  active
                    ? "text-text-high"
                    : "text-muted-dim hover:text-text",
                ].join(" ")}
              >
                {active && (
                  <span className="absolute inset-0 rounded-sm bg-amber-glow/[0.07] ring-1 ring-amber-deep/60" />
                )}
                <span className="relative">{r.code}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1" />

      {/* Counts */}
      <div className="flex items-end gap-6 pb-1">
        <div className="flex flex-col items-end">
          <span className="label">Showing</span>
          <span className="font-mono text-sm tabular-nums text-text-high">
            {filteredCount.toString().padStart(2, "0")}
            <span className="text-muted-dim"> / </span>
            <span className="text-muted">
              {totalCount.toString().padStart(2, "0")}
            </span>
          </span>
        </div>

        {/* Last-tick + Force-tick are dispatch-engine telemetry, not player
            signal. Hide unless ?dev=1 is on. */}
        {isDev && lastTick && (
          <div className="flex flex-col items-end">
            <span className="label">Last tick</span>
            <span className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
              <span
                className={
                  lastTick.inserted > 0 ? "text-amber-glow" : "text-muted-dim"
                }
              >
                +{lastTick.inserted} new
              </span>
              <span className="text-muted-faint">·</span>
              <span
                className={
                  lastTick.expired > 0
                    ? "text-urgency-urgent"
                    : "text-muted-dim"
                }
              >
                {lastTick.expired} aged out
              </span>
            </span>
          </div>
        )}

        {isDev && (
          <button
            type="button"
            onClick={onTickNow}
            disabled={isTicking}
            className="group relative inline-flex h-9 items-center gap-2 self-end rounded-sm border border-amber-deep bg-amber-glow/[0.06] px-4 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.12] hover:text-amber-warm disabled:opacity-40"
          >
            <span className="relative flex h-1.5 w-1.5">
              {isTicking && (
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/70" />
              )}
              <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
            </span>
            {isTicking ? "Ticking…" : "Force tick · DEV"}
          </button>
        )}
      </div>
    </div>
  );
}
