interface Props {
  index: string; // "01"
  code: string; // "RTG"
  label: string; // "Certifications"
  title: string; // "Ratings"
  hint?: string; // small right-side hint, e.g. "1 / 4 earned"
}

// Header used between Career sections — printed-document feel.
// Numeric chapter index, callsign code, en-dash, label, then a long
// ticked ruler line that runs across to the right edge.
export function SectionHeader({ index, code, label, title, hint }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
          § {index}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
          {code}
        </span>
        <span className="text-amber-deep/60">·</span>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-4">
        <h2 className="font-display text-[26px] font-semibold leading-none tracking-tight text-text-high">
          {title}
        </h2>
        <TickRule />
        {hint && (
          <span className="font-mono text-[10px] uppercase tracking-callsign tabular-nums text-muted-dim">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function TickRule() {
  return (
    <div
      className="relative h-3 flex-1"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(212,165,116,0.30), rgba(212,165,116,0.30) 50%, transparent 50%)",
        backgroundSize: "8px 1px",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "0 50%",
      }}
    >
      <span className="absolute inset-y-0 left-0 w-px bg-amber-deep/60" />
      <span className="absolute inset-y-0 right-0 w-px bg-amber-deep/30" />
    </div>
  );
}
