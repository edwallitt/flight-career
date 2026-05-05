import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import { FleetCard } from "./FleetCard.js";
import { HangarDrawer } from "./HangarDrawer.js";

export function Hangar() {
  const navigate = useNavigate();
  const [inspectId, setInspectId] = useState<number | null>(null);

  const fleetQuery = trpc.hangar.fleet.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const fleet = fleetQuery.data ?? [];
  const totalEstimatedValue = fleet.reduce(
    (sum, a) => sum + a.estimatedValueCents,
    0,
  );
  const totalMonthlyCosts = fleet.reduce(
    (sum, a) => sum + a.monthlyFixedCostsCents,
    0,
  );

  const drawerOpen = inspectId != null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-end justify-between border-b border-ink-600 bg-ink-850 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · HGR
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
            Hangar
          </h1>
          <p className="text-tiny text-muted">Your fleet</p>
        </div>

        {fleet.length > 0 && (
          <div className="flex items-end gap-6 font-mono text-[12px]">
            <div className="flex flex-col items-end">
              <span className="label">Aircraft</span>
              <span className="text-[18px] tabular-nums text-text-high">
                {fleet.length}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="label">Est. value</span>
              <span className="text-[18px] tabular-nums text-amber-warm">
                {formatCash(totalEstimatedValue)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="label">Fixed / mo</span>
              <span className="text-[18px] tabular-nums text-text-high">
                {formatCash(totalMonthlyCosts)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        className="relative flex min-h-0 flex-1 transition-[padding] duration-200"
        style={{ paddingRight: drawerOpen ? 460 : 0 }}
      >
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {fleetQuery.isPending ? (
            <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              loading fleet…
            </div>
          ) : fleet.length === 0 ? (
            <EmptyState onBrowse={() => navigate("/market")} />
          ) : (
            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
              {fleet.map((a) => (
                <FleetCard
                  key={a.id}
                  aircraft={a}
                  onInspect={() => setInspectId(a.id)}
                  isSelected={inspectId === a.id}
                />
              ))}
            </div>
          )}
        </div>

        <HangarDrawer
          aircraftId={inspectId}
          onClose={() => setInspectId(null)}
        />
      </div>
    </div>
  );
}

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative w-[440px] rounded-sm border border-ink-600 bg-ink-800/70 px-10 py-12 text-center">
        <span className="pointer-events-none absolute -left-px -top-px block h-3 w-3 border-l border-t border-amber-deep" />
        <span className="pointer-events-none absolute -right-px -top-px block h-3 w-3 border-r border-t border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -left-px block h-3 w-3 border-b border-l border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -right-px block h-3 w-3 border-b border-r border-amber-deep" />

        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          Module · HGR
        </div>
        <div className="mt-3 font-display text-2xl font-semibold tracking-tight text-text-high">
          No aircraft yet
        </div>
        <div className="mt-3 text-sm text-muted">
          Visit the Market to browse aircraft for sale.
        </div>
        <button
          type="button"
          onClick={onBrowse}
          className="mt-6 rounded-sm border border-amber-deep bg-amber-glow/[0.08] px-5 py-2 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm"
        >
          Browse Market
        </button>
      </div>
    </div>
  );
}
