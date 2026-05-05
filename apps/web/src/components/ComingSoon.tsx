export function ComingSoon({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative w-[420px] rounded-sm border border-ink-600 bg-ink-800/70 px-10 py-12 text-center">
        {/* Corner ticks */}
        <span className="pointer-events-none absolute -left-px -top-px block h-3 w-3 border-l border-t border-amber-deep" />
        <span className="pointer-events-none absolute -right-px -top-px block h-3 w-3 border-r border-t border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -left-px block h-3 w-3 border-b border-l border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -right-px block h-3 w-3 border-b border-r border-amber-deep" />

        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          Module · {code}
        </div>
        <div className="mt-3 font-display text-3xl font-semibold tracking-tight text-text-high">
          {title}
        </div>
        <div className="mt-3 text-sm text-muted">
          This console is offline pending fielding. Check back after dispatch
          stabilizes.
        </div>

        <div className="mt-7 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          <span className="h-px w-8 bg-amber-dim/60" />
          status · standby
          <span className="h-px w-8 bg-amber-dim/60" />
        </div>
      </div>
    </div>
  );
}
