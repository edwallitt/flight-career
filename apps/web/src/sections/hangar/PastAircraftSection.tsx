import { useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

export function PastAircraftSection() {
  const [open, setOpen] = useState(false);
  const query = trpc.sale.pastAircraft.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mt-6 rounded-sm border border-ink-600 bg-ink-800/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-750/40"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
          <span className="text-amber-glow">Past aircraft</span>
          <span className="rounded-sm border border-ink-600 px-1.5 py-0.5 text-[10px] text-text-high">
            {rows.length}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="border-t border-ink-600 px-4 py-3">
          <ul className="flex flex-col divide-y divide-ink-600">
            {rows.map((r) => {
              const positive = r.netCents >= 0;
              return (
                <li
                  key={r.id}
                  className="grid grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(120px,auto)] items-baseline gap-4 py-2 font-mono text-[11px]"
                >
                  <div>
                    <div className="text-text-high">{r.tailNumber}</div>
                    <div className="text-[10px] uppercase tracking-callsign text-muted-dim">
                      {r.manufacturer} {r.model} ·{" "}
                      <span className="text-amber-deep">
                        {r.aircraftClass}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="label">Purchased</div>
                    <div className="tabular-nums text-text-high">
                      {formatCash(r.purchasePriceCents)}
                    </div>
                    <div className="text-[10px] text-muted-dim">
                      {formatSimDateTime(r.purchasedAt)}
                    </div>
                  </div>
                  <div>
                    <div className="label">Sold</div>
                    <div className="tabular-nums text-text-high">
                      {formatCash(r.salePriceCents)}
                    </div>
                    <div className="text-[10px] text-muted-dim">
                      {formatSimDateTime(r.soldAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">P&amp;L</div>
                    <div
                      className={[
                        "tabular-nums",
                        positive ? "text-emerald-300" : "text-urgency-critical",
                      ].join(" ")}
                    >
                      {positive ? "+" : "−"}
                      {formatCash(Math.abs(r.netCents))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
