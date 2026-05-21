// Inline legend for the four fit states surfaced on every row. Lives
// between the FleetStrip and the JobFilters so new players can decode the
// dot column at a glance; once they've internalised it, it's small enough
// to ignore. Keep the glyph styling in lock-step with JobTable's
// FIT_GLYPH — they're the same visual vocabulary.

const ENTRIES: { dot: string; label: string; tone: string; title: string }[] = [
  {
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.55)]",
    label: "Ready",
    tone: "text-emerald-300",
    title:
      "An aircraft you can dispatch is at the origin and fits payload, range, and any capability requirement.",
  },
  {
    dot: "bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.55)]",
    label: "Reposition",
    tone: "text-amber-glow",
    title:
      "An aircraft fits the job, but you'd need to ferry to the origin first. Hover the row for the distance.",
  },
  {
    dot: "bg-urgency-urgent shadow-[0_0_6px_rgba(232,160,76,0.45)]",
    label: "Won't fit",
    tone: "text-urgency-urgent",
    title:
      "You can fly the class, but your aircraft is over payload, short on range, or missing a capability like unpaved.",
  },
  {
    dot: "bg-ink-500",
    label: "Locked",
    tone: "text-muted-dim",
    title:
      "No aircraft of the required class is available to you here, or you lack the rating.",
  },
];

export function FitLegend() {
  return (
    <div className="flex items-center gap-3 border-b border-ink-700/70 bg-ink-850/40 px-6 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
        Fit
      </span>
      <div className="flex items-center gap-3">
        {ENTRIES.map((e) => (
          <span
            key={e.label}
            title={e.title}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign"
          >
            <span className={["h-1.5 w-1.5 rounded-full", e.dot].join(" ")} />
            <span className={e.tone}>{e.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
