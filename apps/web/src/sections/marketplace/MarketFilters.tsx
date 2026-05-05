import type { ClassFilter, MaxPriceFilter, SortKey } from "./types.js";

const CLASSES: { id: ClassFilter; label: string }[] = [
  { id: "any", label: "All" },
  { id: "SEP", label: "SEP" },
  { id: "MEP", label: "MEP" },
  { id: "SET", label: "SET" },
  { id: "JET", label: "JET" },
];

const PRICES: { id: MaxPriceFilter; label: string }[] = [
  { id: 10_000_000, label: "$100K" },
  { id: 50_000_000, label: "$500K" },
  { id: 100_000_000, label: "$1M" },
  { id: 500_000_000, label: "$5M" },
  { id: "any", label: "Any" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "distance", label: "Distance" },
  { id: "price_asc", label: "Price ↑" },
  { id: "price_desc", label: "Price ↓" },
  { id: "hours", label: "Hours ↑" },
];

export function MarketFilters({
  classFilter,
  setClassFilter,
  maxPrice,
  setMaxPrice,
  sortKey,
  setSortKey,
  totalCount,
  filteredCount,
  onRefresh,
  isRefreshing,
}: {
  classFilter: ClassFilter;
  setClassFilter: (c: ClassFilter) => void;
  maxPrice: MaxPriceFilter;
  setMaxPrice: (p: MaxPriceFilter) => void;
  sortKey: SortKey;
  setSortKey: (s: SortKey) => void;
  totalCount: number;
  filteredCount: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="flex items-stretch gap-6 border-b border-ink-600 bg-ink-800/40 px-6 py-3">
      <div className="flex flex-col gap-1.5">
        <span className="label">Class</span>
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
                  active ? "text-text-high" : "text-muted-dim hover:text-text",
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

      <div className="flex flex-col gap-1.5">
        <span className="label">Max price</span>
        <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
          {PRICES.map((p) => {
            const active = maxPrice === p.id;
            return (
              <button
                key={String(p.id)}
                type="button"
                onClick={() => setMaxPrice(p.id)}
                className={[
                  "relative px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                  active ? "text-text-high" : "text-muted-dim hover:text-text",
                ].join(" ")}
              >
                {active && (
                  <span className="absolute inset-0 rounded-sm bg-amber-glow/[0.07] ring-1 ring-amber-deep/60" />
                )}
                <span className="relative">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="label">Sort</span>
        <div className="flex items-center rounded-sm border border-ink-600 bg-ink-750 p-0.5">
          {SORTS.map((s) => {
            const active = sortKey === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortKey(s.id)}
                className={[
                  "relative px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                  active ? "text-text-high" : "text-muted-dim hover:text-text",
                ].join(" ")}
              >
                {active && (
                  <span className="absolute inset-0 rounded-sm bg-amber-glow/[0.07] ring-1 ring-amber-deep/60" />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1" />

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

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="group relative inline-flex h-9 items-center gap-2 self-end rounded-sm border border-amber-deep bg-amber-glow/[0.06] px-4 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.12] hover:text-amber-warm disabled:opacity-40"
        >
          <span className="relative flex h-1.5 w-1.5">
            {isRefreshing && (
              <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/70" />
            )}
            <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
          </span>
          {isRefreshing ? "Refreshing…" : "Refresh listings"}
        </button>
      </div>
    </div>
  );
}
