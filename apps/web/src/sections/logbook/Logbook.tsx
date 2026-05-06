import { useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import { LogbookFlights } from "./LogbookFlights.js";
import { LogbookFinances } from "./LogbookFinances.js";
import { LogbookMaintenance } from "./LogbookMaintenance.js";

type TabKey = "flights" | "finances" | "maintenance";

const TABS: { key: TabKey; label: string; code: string }[] = [
  { key: "flights", label: "Flights", code: "FLT" },
  { key: "finances", label: "Finances", code: "FIN" },
  { key: "maintenance", label: "Maintenance", code: "MNT" },
];

function formatHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function Logbook() {
  const [tab, setTab] = useState<TabKey>("flights");
  const headlineQuery = trpc.logbook.headline.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const headline = headlineQuery.data;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Section heading */}
      <div className="flex items-end justify-between border-b border-ink-600 bg-ink-850 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · LOG
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
            Logbook
          </h1>
          <p className="text-tiny text-muted">Career history</p>
        </div>

        {headline && (
          <div className="flex items-end gap-6 font-mono text-[12px]">
            <div className="flex flex-col items-end">
              <span className="label">Flights</span>
              <span className="text-[18px] tabular-nums text-text-high">
                {headline.totalFlights}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="label">Block hours</span>
              <span className="text-[18px] tabular-nums text-text-high">
                {formatHours(headline.totalBlockMinutes)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="label">Net earnings</span>
              <span
                className={[
                  "text-[18px] tabular-nums",
                  headline.totalNetCents >= 0
                    ? "text-emerald-300"
                    : "text-urgency-critical",
                ].join(" ")}
              >
                {headline.totalNetCents >= 0 ? "+" : "−"}
                {formatCash(Math.abs(headline.totalNetCents))}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-ink-600 bg-ink-850">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                "relative flex items-center gap-3 px-5 py-3 text-left transition-colors",
                active
                  ? "bg-amber-glow/[0.05] text-text-high"
                  : "text-muted-dim hover:bg-ink-750/50 hover:text-text",
              ].join(" ")}
            >
              <span className="font-mono text-[12px] uppercase tracking-callsign">
                {t.label}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                {t.code}
              </span>
              {active && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-amber-glow" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="relative flex min-h-0 flex-1">
        {tab === "flights" && <LogbookFlights />}
        {tab === "finances" && <LogbookFinances />}
        {tab === "maintenance" && <LogbookMaintenance />}
      </div>
    </div>
  );
}
