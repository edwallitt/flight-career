import type { ClassFilter, RoleFilter } from "./types.js";

const ROLES: { id: RoleFilter; label: string; code: string }[] = [
  { id: "all", label: "All", code: "ALL" },
  { id: "bush", label: "Bush", code: "BSH" },
  { id: "air_taxi", label: "Air Taxi", code: "ATX" },
  { id: "light_jet", label: "Light Jet", code: "LJT" },
  { id: "open", label: "Open Market", code: "OPN" },
];

const CLASSES: { id: ClassFilter; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "SEP", label: "SEP" },
  { id: "MEP", label: "MEP" },
  { id: "SET", label: "SET" },
  { id: "JET", label: "JET" },
];

export function JobFilters({
  roleFilter,
  setRoleFilter,
  classFilter,
  setClassFilter,
  totalCount,
  filteredCount,
  onTickNow,
  isTicking,
  lastTick,
}: {
  roleFilter: RoleFilter;
  setRoleFilter: (r: RoleFilter) => void;
  classFilter: ClassFilter;
  setClassFilter: (c: ClassFilter) => void;
  totalCount: number;
  filteredCount: number;
  onTickNow: () => void;
  isTicking: boolean;
  lastTick?: { inserted: number; expired: number };
}) {
  return (
    <div className="flex items-stretch gap-6 border-b border-ink-600 bg-ink-800/40 px-6 py-3">
      {/* Role filter */}
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

      {/* Class filter */}
      <div className="flex flex-col gap-1.5">
        <span className="label">Min class</span>
        <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
          {CLASSES.map((c) => {
            const active = classFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setClassFilter(c.id)}
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
                <span className="relative">{c.label}</span>
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

        {/* Last tick result — quiet readout next to the button */}
        {lastTick && (
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

        {/* Force tick — primary dev affordance */}
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
          {isTicking ? "Ticking…" : "Force tick"}
        </button>
      </div>
    </div>
  );
}
