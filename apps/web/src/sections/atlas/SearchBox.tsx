import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AtlasAirport,
  AtlasOwnedAircraft,
} from "../../components/map/AtlasMap.js";

// Search hit: either an airport (ICAO + name) or an owned aircraft (tail
// number). Both have a lat/lon so the caller can pan-and-zoom the map.
// Clients are intentionally excluded — the atlas has no client feature to
// open, so a "Maritime Cargo" search result would have nothing useful to
// do on this surface. Job Board search is a better home for that later.
export type AtlasSearchHit =
  | {
      type: "airport";
      icao: string;
      primary: string;
      secondary: string;
      lat: number;
      lon: number;
    }
  | {
      type: "aircraft";
      id: number;
      primary: string;
      secondary: string;
      lat: number;
      lon: number;
    };

interface ScoredHit {
  hit: AtlasSearchHit;
  score: number;
}

const MAX_RESULTS = 8;

// Crude relevance score. Prefix matches beat substring matches; ICAO + tail
// outscore name matches because they're what a player normally types. Lower
// "primary" string lengths get a small boost so an exact short ICAO doesn't
// lose to a long airport name that happens to contain the same letters.
function scoreTerm(needle: string, haystack: string, weight: number): number {
  if (!haystack) return 0;
  if (haystack === needle) return weight * 100;
  if (haystack.startsWith(needle)) return weight * 70;
  if (haystack.includes(needle)) return weight * 40;
  return 0;
}

function buildHits(
  query: string,
  airports: AtlasAirport[],
  ownedAircraft: AtlasOwnedAircraft[],
): AtlasSearchHit[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return [];
  const scored: ScoredHit[] = [];

  for (const a of airports) {
    const icao = a.icao.toLowerCase();
    const name = a.name.toLowerCase();
    const score = Math.max(scoreTerm(term, icao, 1), scoreTerm(term, name, 0.7));
    if (score > 0) {
      scored.push({
        hit: {
          type: "airport",
          icao: a.icao,
          primary: a.icao,
          secondary: a.name,
          lat: a.lat,
          lon: a.lon,
        },
        score,
      });
    }
  }

  for (const ac of ownedAircraft) {
    const tail = ac.tailNumber.toLowerCase();
    const score = scoreTerm(term, tail, 1);
    if (score > 0) {
      scored.push({
        hit: {
          type: "aircraft",
          id: ac.id,
          primary: ac.tailNumber,
          secondary: `${ac.aircraftTypeLabel} · ${ac.currentLocationIcao}`,
          lat: ac.lat,
          lon: ac.lon,
        },
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map((s) => s.hit);
}

export function SearchBox({
  airports,
  ownedAircraft,
  onSelect,
}: {
  airports: AtlasAirport[];
  ownedAircraft: AtlasOwnedAircraft[];
  onSelect: (hit: AtlasSearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(
    () => buildHits(query, airports, ownedAircraft),
    [query, airports, ownedAircraft],
  );

  // Reset highlight when results change so the user doesn't end up pointing
  // at a stale index past the new list length.
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  // "/" focuses the search — common ops-console keybinding, doesn't fight
  // map drag or layer toggles. Suppressed while the user is already typing
  // somewhere (text input, textarea) so it doesn't capture a literal slash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-outside dismisses the dropdown. We don't blur the input — the
  // player may want to keep typing after toggling a layer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commit = (hit: AtlasSearchHit) => {
    onSelect(hit);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) commit(hit);
    }
  };

  const showDropdown = open && results.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-750 px-2.5 py-1.5 focus-within:border-amber-deep/70">
        {/* magnifier glyph */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          aria-hidden
          className="shrink-0 text-muted-faint"
        >
          <circle
            cx="4.5"
            cy="4.5"
            r="3"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <line
            x1="7"
            y1="7"
            x2="10"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search ICAO, airport, tail…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-transparent font-mono text-[11px] uppercase tracking-callsign text-text outline-none placeholder:text-muted-faint placeholder:normal-case placeholder:tracking-normal"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 font-mono text-[10px] text-muted-faint hover:text-amber-glow"
          >
            ✕
          </button>
        )}
        <kbd className="hidden shrink-0 rounded-sm border border-ink-600 px-1 font-mono text-[9px] uppercase tracking-callsign text-muted-faint sm:inline">
          /
        </kbd>
      </div>

      {showDropdown && (
        <div
          // Sits above the rest of the left panel without pushing layout —
          // search is a transient action surface, not part of the doctrine
          // rhythm. shadow gives it visual lift over the layer rows.
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[280px] overflow-y-auto rounded-sm border border-ink-600 bg-ink-800 shadow-lg"
        >
          {results.map((hit, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={
                  hit.type === "airport"
                    ? `airport:${hit.icao}`
                    : `aircraft:${hit.id}`
                }
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => commit(hit)}
                className={[
                  "flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors",
                  active
                    ? "bg-amber-glow/[0.08] text-amber-glow"
                    : "text-text hover:bg-ink-750",
                ].join(" ")}
              >
                <span
                  className={[
                    "shrink-0 rounded-sm border px-1 font-mono text-[9px] uppercase tracking-callsign",
                    hit.type === "airport"
                      ? "border-amber-deep/60 text-amber-deep"
                      : "border-emerald-500/40 text-emerald-300",
                  ].join(" ")}
                >
                  {hit.type === "airport" ? "APT" : "ACFT"}
                </span>
                <span className="icao font-mono text-[12px] text-text-high">
                  {hit.primary}
                </span>
                <span className="ml-1 truncate font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                  {hit.secondary}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty-state hint: render only when the user typed something but
          nothing matched. Otherwise the dropdown stays closed. */}
      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-sm border border-ink-600 bg-ink-800 px-2.5 py-2 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          No matches
        </div>
      )}
    </div>
  );
}
