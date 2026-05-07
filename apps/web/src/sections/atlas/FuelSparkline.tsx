import { trpc } from "../../trpc.js";

interface FuelSparklineProps {
  airportIcao: string;
  fuelType: "avgas" | "jet-a";
  windowDays?: number;
}

interface SparklinePathProps {
  width: number;
  height: number;
  values: number[];
}

function SparklinePath({ width, height, values }: SparklinePathProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max === min ? 1 : max - min;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    // Normalize so highest price renders near the top.
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const fillPath =
    `M0,${height} ` +
    points
      .map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ") +
    ` L${width},${height} Z`;
  return (
    <g>
      <path d={fillPath} fill="rgba(212,165,116,0.10)" />
      <path
        d={linePath}
        fill="none"
        stroke="rgb(212,165,116)"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
}

function trendArrow(
  earliest: number,
  latest: number,
): { glyph: string; pct: number; tone: string } {
  const pct = earliest > 0 ? ((latest - earliest) / earliest) * 100 : 0;
  if (pct > 2) return { glyph: "↗", pct, tone: "text-urgency-urgent" };
  if (pct < -2) return { glyph: "↘", pct, tone: "text-emerald-300" };
  return { glyph: "→", pct, tone: "text-muted" };
}

export function FuelSparkline({
  airportIcao,
  fuelType,
  windowDays = 7,
}: FuelSparklineProps) {
  const { data, isLoading } = trpc.fuel.priceHistory.useQuery(
    { airportIcao, fuelType, windowDays },
    { staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="mt-1 h-[24px] w-full animate-pulse rounded-sm bg-ink-700" />
    );
  }

  const points = data ?? [];
  if (points.length < 2) {
    return (
      <div className="mt-1 flex h-[24px] items-center font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
        no history yet
      </div>
    );
  }

  const earliest = points[0]!.priceCents;
  const latest = points[points.length - 1]!.priceCents;
  const trend = trendArrow(earliest, latest);
  const sign = trend.pct >= 0 ? "+" : "";

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div
        className={[
          "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-callsign",
          trend.tone,
        ].join(" ")}
      >
        <span>{trend.glyph}</span>
        <span className="tabular-nums">
          {sign}
          {trend.pct.toFixed(1)}%
        </span>
        <span className="text-muted-faint">({windowDays}d)</span>
      </div>
      <svg
        viewBox="0 0 80 24"
        preserveAspectRatio="none"
        width={80}
        height={24}
        className="block"
      >
        <SparklinePath
          width={80}
          height={24}
          values={points.map((p) => p.priceCents)}
        />
      </svg>
    </div>
  );
}
