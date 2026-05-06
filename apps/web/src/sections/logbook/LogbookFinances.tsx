import { useMemo, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

interface Point {
  simTime: number;
  cumulativeNet: number;
}

export function LogbookFinances() {
  const summary = trpc.logbook.financialSummary.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const data = summary.data;

  if (summary.isPending || !data) {
    return (
      <div className="flex h-full w-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
        loading finances…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {/* Headline cards row */}
      <div className="grid grid-cols-3 gap-4">
        <HeadlineCard
          label="Total revenue"
          valueCents={data.totalRevenue}
          subtitle={`${data.flightCount} flight${data.flightCount === 1 ? "" : "s"} flown`}
          tone="emerald"
        />
        <HeadlineCard
          label="Total costs"
          valueCents={data.totalCosts}
          subtitle="All categories"
          tone="critical"
        />
        <HeadlineCard
          label="Net"
          valueCents={data.totalNet}
          subtitle="Career to date"
          tone={data.totalNet >= 0 ? "amber" : "critical"}
          showSign
        />
      </div>

      {/* Combined dashboard frame: chart + ledger */}
      <div className="relative mt-5 rounded-sm border border-ink-600 bg-ink-800">
        <FrameTicks />

        <div className="grid grid-cols-5 gap-px bg-ink-600">
          {/* Chart side (3/5) */}
          <div className="col-span-3 bg-ink-800 p-5">
            <div className="flex items-center gap-2">
              <span className="label">Net over time</span>
              <span className="h-px flex-1 bg-ink-600" />
              <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                cum · {data.netOverTime.length} pts
              </span>
            </div>
            <div className="mt-4">
              {data.netOverTime.length < 5 ? (
                <ChartEmpty count={data.netOverTime.length} />
              ) : (
                <NetChart points={data.netOverTime} />
              )}
            </div>
          </div>

          {/* Ledger side (2/5) */}
          <div className="col-span-2 bg-ink-800 p-5">
            <div className="flex items-center gap-2">
              <span className="label">Cost & revenue ledger</span>
              <span className="h-px flex-1 bg-ink-600" />
            </div>

            <div className="mt-4 space-y-4">
              <LedgerSection heading="Revenue">
                <LedgerLine
                  label="Flight earnings"
                  cents={data.byCategory.flightRevenue}
                  positive
                />
              </LedgerSection>

              <LedgerSection heading="Costs">
                <LedgerLine label="Fuel & landing fees" cents={data.byCategory.flightCosts} />
                <LedgerLine label="Travel & repositioning" cents={data.byCategory.travelCosts} />
                <LedgerLine label="Aircraft purchases" cents={data.byCategory.aircraftPurchases} />
                <LedgerLine label="Loan payments" cents={data.byCategory.loanPayments} />
                <LedgerLine label="Maintenance" cents={data.byCategory.maintenanceCosts} />
              </LedgerSection>

              <div className="mt-2 border-t border-ink-600 pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-callsign text-text-high">
                    Net
                  </span>
                  <span
                    className={[
                      "font-mono text-[18px] tabular-nums",
                      data.totalNet >= 0
                        ? "text-amber-warm"
                        : "text-urgency-critical",
                    ].join(" ")}
                  >
                    {data.totalNet < 0 ? "−" : ""}
                    {formatCash(Math.abs(data.totalNet))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline card (4 corner ticks)
// ---------------------------------------------------------------------------

function HeadlineCard({
  label,
  valueCents,
  subtitle,
  tone,
  showSign,
}: {
  label: string;
  valueCents: number;
  subtitle: string;
  tone: "emerald" | "critical" | "amber";
  showSign?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "critical"
        ? "text-urgency-critical"
        : "text-amber-warm";

  const display =
    showSign && valueCents < 0
      ? `−${formatCash(Math.abs(valueCents))}`
      : showSign && valueCents > 0
        ? `+${formatCash(valueCents)}`
        : formatCash(Math.abs(valueCents));

  return (
    <div className="relative rounded-sm border border-ink-600 bg-ink-800 px-5 py-5">
      <FrameTicks />
      <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
        {label}
      </div>
      <div className={`mt-2 font-mono text-[28px] tabular-nums ${toneClass}`}>
        {display}
      </div>
      <div className="mt-1 text-tiny text-muted">{subtitle}</div>
    </div>
  );
}

function FrameTicks() {
  return (
    <>
      <span className="pointer-events-none absolute -left-px -top-px block h-3 w-3 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute -right-px -top-px block h-3 w-3 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute -bottom-px -left-px block h-3 w-3 border-b border-l border-amber-deep/70" />
      <span className="pointer-events-none absolute -bottom-px -right-px block h-3 w-3 border-b border-r border-amber-deep/70" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Ledger lines with dotted leaders
// ---------------------------------------------------------------------------

function LedgerSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
        {heading}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function LedgerLine({
  label,
  cents,
  positive,
}: {
  label: string;
  cents: number;
  positive?: boolean;
}) {
  const tone = positive ? "text-emerald-300" : "text-text";
  return (
    <li className="flex items-baseline gap-2 font-mono text-[12px]">
      <span className="text-muted">· {label}</span>
      <span
        aria-hidden
        className="mx-1 mb-1 flex-1 border-b border-dotted border-ink-600/80"
      />
      <span className={`tabular-nums ${tone}`}>{formatCash(cents)}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function ChartEmpty({ count }: { count: number }) {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-ink-600 bg-ink-850/50">
      <div className="font-mono text-micro uppercase tracking-callsign text-muted-dim">
        Awaiting data · {count} / 5
      </div>
      <div className="max-w-[280px] text-center text-tiny text-muted-faint">
        The trend line activates once five flights are logged.
      </div>
    </div>
  );
}

function NetChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo<Point[]>(() => {
    if (points.length === 0) return [];
    const first = points[0]!;
    return [{ simTime: first.simTime - 1, cumulativeNet: 0 }, ...points];
  }, [points]);

  if (series.length === 0) return null;

  const width = 800;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 30, left: 70 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const minTime = series[0]!.simTime;
  const maxTime = series[series.length - 1]!.simTime;
  const timeSpan = Math.max(1, maxTime - minTime);

  const minNet = Math.min(0, ...series.map((p) => p.cumulativeNet));
  const maxNet = Math.max(0, ...series.map((p) => p.cumulativeNet));
  const netSpan = Math.max(1, maxNet - minNet);

  const xFor = (t: number) => pad.left + ((t - minTime) / timeSpan) * innerW;
  const yFor = (n: number) =>
    pad.top + innerH - ((n - minNet) / netSpan) * innerH;

  const path = series
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(p.simTime).toFixed(1)} ${yFor(p.cumulativeNet).toFixed(1)}`,
    )
    .join(" ");

  const baselineY = yFor(0);
  const fillPath = `${path} L ${xFor(maxTime).toFixed(1)} ${baselineY.toFixed(1)} L ${xFor(minTime).toFixed(1)} ${baselineY.toFixed(1)} Z`;

  const gridSteps = 4;
  const gridLines: number[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    gridLines.push(minNet + ((maxNet - minNet) * i) / gridSteps);
  }

  const hoverPoint = hover != null ? series[hover] ?? null : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[240px] w-full"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const xRel = (xPx / rect.width) * width - pad.left;
          const tHover = minTime + (xRel / innerW) * timeSpan;
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < series.length; i++) {
            const d = Math.abs(series[i]!.simTime - tHover);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          setHover(bestIdx);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((v, i) => {
          const y = yFor(v);
          const isZero = Math.abs(v) < 0.5;
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke={
                  isZero ? "rgba(212,165,116,0.30)" : "rgba(255,255,255,0.05)"
                }
                strokeWidth={1}
                strokeDasharray={isZero ? undefined : "2 4"}
              />
              <text
                x={pad.left - 10}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-faint"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize="10"
                letterSpacing="0.04em"
                style={{ fontFeatureSettings: "'tnum' 1" }}
              >
                {formatCashTick(v)}
              </text>
            </g>
          );
        })}

        {/* X-axis ticks (5 evenly spaced) */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const t = minTime + frac * timeSpan;
          const x = xFor(t);
          return (
            <g key={frac}>
              <line
                x1={x}
                x2={x}
                y1={height - pad.bottom}
                y2={height - pad.bottom + 3}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={height - pad.bottom + 16}
                textAnchor={frac === 0 ? "start" : frac === 1 ? "end" : "middle"}
                className="fill-muted-faint"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize="9"
                letterSpacing="0.08em"
              >
                {formatTickDate(t)}
              </text>
            </g>
          );
        })}

        <path d={fillPath} fill="rgba(212,165,116,0.10)" />
        <path
          d={path}
          fill="none"
          stroke="rgba(212,165,116,0.95)"
          strokeWidth={1.5}
        />

        {hoverPoint && (
          <g>
            <line
              x1={xFor(hoverPoint.simTime)}
              x2={xFor(hoverPoint.simTime)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="rgba(212,165,116,0.5)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <circle
              cx={xFor(hoverPoint.simTime)}
              cy={yFor(hoverPoint.cumulativeNet)}
              r={3.5}
              fill="rgb(212,165,116)"
              stroke="rgb(28,30,34)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {hoverPoint && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-sm border border-ink-600 bg-ink-750/95 px-3 py-2 font-mono text-[11px] shadow-lg">
          <div className="text-muted-dim">
            {formatSimDateTime(hoverPoint.simTime)}
          </div>
          <div
            className={[
              "tabular-nums",
              hoverPoint.cumulativeNet >= 0
                ? "text-emerald-300"
                : "text-urgency-critical",
            ].join(" ")}
          >
            {hoverPoint.cumulativeNet >= 0 ? "+" : "−"}
            {formatCash(Math.abs(hoverPoint.cumulativeNet))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCashTick(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`;
  if (dollars === 0) return "$0";
  return `$${Math.round(dollars)}`;
}

function formatTickDate(ms: number): string {
  const d = new Date(ms);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]}`;
}
