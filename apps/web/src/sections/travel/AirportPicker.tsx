import { useMemo, useState } from "react";

export interface AirportOption {
  icao: string;
  name: string;
}

export function AirportPicker({
  options,
  value,
  onChange,
  excludeIcao,
  placeholder = "Search ICAO or name…",
}: {
  options: AirportOption[];
  value: string | null;
  onChange: (icao: string | null) => void;
  excludeIcao?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => o.icao !== excludeIcao)
      .filter(
        (o) =>
          q === "" ||
          o.icao.toLowerCase().includes(q) ||
          o.name.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [options, query, excludeIcao]);

  const selected = options.find((o) => o.icao === value) ?? null;

  if (selected && !open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
          onChange(null);
        }}
        className="group flex w-full items-center justify-between rounded-sm border border-amber-deep/60 bg-amber-glow/[0.04] px-3 py-2 text-left transition-colors hover:bg-amber-glow/[0.08]"
      >
        <span>
          <span className="icao text-text-high">{selected.icao}</span>
          <span className="ml-3 text-tiny text-muted">{selected.name}</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim group-hover:text-amber-glow">
          change
        </span>
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-ink-600 bg-ink-750 px-3 py-2 font-mono text-[13px] text-text-high outline-none focus:border-amber-deep"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-sm border border-ink-600 bg-ink-800 shadow-2xl">
          {filtered.map((o) => (
            <li key={o.icao}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.icao);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-ink-700"
              >
                <span className="icao text-text-high">{o.icao}</span>
                <span className="ml-3 truncate text-tiny text-muted">
                  {o.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-tiny text-muted-dim">
          No matches
        </div>
      )}
    </div>
  );
}
