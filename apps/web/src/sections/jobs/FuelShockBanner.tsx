import { trpc } from "../../trpc.js";

const SIM_TICKS_PER_DAY = 4; // drift ticks: 24h / 6h
function ticksToDays(ticks: number): number {
  return ticks / SIM_TICKS_PER_DAY;
}

export function FuelShockBanner() {
  const { data } = trpc.fuel.activeShocks.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const headline = data?.headline;
  if (!headline) return null;

  const daysRemaining = ticksToDays(headline.ticksRemaining);
  const remainingLabel =
    daysRemaining >= 1
      ? `${daysRemaining.toFixed(1)} sim days remaining`
      : "less than a sim day remaining";

  return (
    <div className="flex items-center gap-3 border-b border-amber-deep/40 bg-amber-glow/[0.06] px-6 py-2.5 font-mono text-[11px] text-amber-warm">
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-sm border border-amber-deep/70 bg-amber-glow/[0.10] text-[10px] text-amber-glow"
      >
        ⚠
      </span>
      <span className="uppercase tracking-callsign text-amber-glow">
        Fuel shock
      </span>
      <span className="text-text-high normal-case tracking-normal">
        {headline.headline}
      </span>
      <span className="text-muted normal-case tracking-normal">·</span>
      <span className="tabular-nums text-muted normal-case tracking-normal">
        {remainingLabel}
      </span>
    </div>
  );
}
