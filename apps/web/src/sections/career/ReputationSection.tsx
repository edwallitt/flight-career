import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { ROLE_LABEL } from "../../lib/formatters.js";
import { SectionHeader } from "./SectionHeader.js";

type Snapshot = NonNullable<inferRouterOutputs<AppRouter>["career"]["snapshot"]>;
type ByRole = Snapshot["reputation"]["byRole"];
type ByClient = Snapshot["reputation"]["byClient"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TIER_LABEL: Record<string, string> = {
  novice: "Novice",
  mid: "Mid",
  high: "High",
  top: "Top",
};

const TIER_TONE: Record<string, string> = {
  novice: "text-muted-faint",
  mid: "text-muted",
  high: "text-amber-glow",
  top: "text-amber-warm",
};

const ROLE_GLYPH: Record<string, string> = {
  bush: "▲", // bush flying — peaks
  air_taxi: "◆", // taxi — diamond
  light_jet: "►", // jet — arrow
};

function relativeSimDays(targetMs: number, nowMs: number): string {
  const diff = nowMs - targetMs;
  const days = Math.floor(diff / MS_PER_DAY);
  if (days <= 0) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  return `${days}d ago`;
}

// Reputation bar with tier-zone markers at 25, 60, 85 — small ticks beneath
// the fill so the player can read where the next tier sits without checking
// a legend.
function ReputationBar({
  score,
  tier,
}: {
  score: number;
  tier: string;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const fillTone =
    tier === "top"
      ? "bg-amber-warm"
      : tier === "high"
        ? "bg-amber-glow"
        : tier === "mid"
          ? "bg-muted"
          : "bg-muted-faint";

  return (
    <div className="relative">
      <div className="h-[3px] w-full overflow-hidden rounded-sm bg-ink-700">
        <div
          className={["h-full transition-[width] duration-500", fillTone].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]">
        {[25, 60, 85].map((t) => (
          <span
            key={t}
            className={[
              "absolute h-[5px] w-px",
              score >= t ? "bg-text-high/50" : "bg-amber-deep/40",
            ].join(" ")}
            style={{ left: `${t}%`, top: "-1px" }}
          />
        ))}
      </div>
    </div>
  );
}

function RoleRow({ row }: { row: ByRole[number] }) {
  return (
    <div className="relative flex flex-col gap-2 rounded-sm border border-ink-600 bg-ink-800/50 p-4">
      {/* Left rail */}
      <span
        className={[
          "absolute inset-y-3 left-0 w-px",
          row.tier === "top" || row.tier === "high"
            ? "bg-amber-glow/70"
            : row.tier === "mid"
              ? "bg-muted/40"
              : "bg-ink-500",
        ].join(" ")}
      />

      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[12px] text-amber-deep">
            {ROLE_GLYPH[row.role] ?? "·"}
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-text-high">
            {ROLE_LABEL[row.role] ?? row.role}
          </span>
        </div>
        <div className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-text-high">{row.score}</span>
          <span className="text-muted-faint">/ 100</span>
          <span
            className={[
              "min-w-[3.5rem] text-right uppercase tracking-callsign",
              TIER_TONE[row.tier],
            ].join(" ")}
          >
            {TIER_LABEL[row.tier]}
          </span>
        </div>
      </div>

      <ReputationBar score={row.score} tier={row.tier} />

      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
        <span>
          {row.flightCount === 0
            ? "No work logged"
            : `${row.flightCount} flight${row.flightCount === 1 ? "" : "s"}`}
        </span>
        <span className="text-muted-dim">
          {row.tier === "top"
            ? "Apex"
            : row.tier === "high"
              ? "Trusted"
              : row.tier === "mid"
                ? "Recognised"
                : "Unproven"}
        </span>
      </div>
    </div>
  );
}

function ClientRow({
  row,
  simNow,
  index,
}: {
  row: ByClient[number];
  simNow: number;
  index: number;
}) {
  return (
    <div
      className={[
        "relative grid grid-cols-[20px_1fr_auto] items-center gap-3 rounded-sm border border-ink-600/70 px-3 py-2.5",
        index % 2 === 0 ? "bg-ink-800/40" : "bg-ink-800/20",
      ].join(" ")}
    >
      {/* Index gutter */}
      <span className="font-mono text-[10px] tabular-nums text-muted-faint">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-sans text-[13px] text-text-high">
            {row.clientName}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
            {ROLE_LABEL[row.role] ?? row.role}
          </span>
        </div>
        <ReputationBar score={row.score} tier={row.tier} />
        <div className="flex items-baseline justify-between font-mono text-[10px] tabular-nums">
          <span className="text-muted-dim">
            {row.flightCount === 0
              ? "No flights yet"
              : `${row.flightCount} ${row.flightCount === 1 ? "job" : "jobs"}`}
            {row.lastInteractionAt
              ? ` · ${relativeSimDays(row.lastInteractionAt, simNow)}`
              : ""}
          </span>
          <span
            className={[
              "uppercase tracking-callsign",
              TIER_TONE[row.tier],
            ].join(" ")}
          >
            {TIER_LABEL[row.tier]}
          </span>
        </div>
      </div>

      <div className="font-mono text-[18px] font-semibold leading-none tabular-nums text-text-high">
        {row.score}
      </div>
    </div>
  );
}

export function ReputationSection({
  byRole,
  byClient,
  simNow,
}: {
  byRole: ByRole;
  byClient: ByClient;
  simNow: number;
}) {
  const activeClients = byClient.filter(
    (c) => c.flightCount > 0 || c.score > 0,
  );
  const topRoleScore = Math.max(...byRole.map((r) => r.score), 0);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        index="02"
        code="REP"
        label="Standing"
        title="Reputation"
        hint={`peak · ${topRoleScore}/100`}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
              By role
            </span>
            <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
              ▲ bush · ◆ taxi · ► jet
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {byRole.map((row) => (
              <RoleRow key={row.role} row={row} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
              By client
            </span>
            <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
              {activeClients.length} active
            </span>
          </div>
          {activeClients.length === 0 ? (
            <div className="relative flex min-h-[200px] flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-ink-600 bg-ink-800/20 px-6 py-8 text-center">
              <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-deep">
                — No client work logged —
              </span>
              <p className="text-[12px] text-muted-dim">
                Standing builds when you complete <em>client</em> jobs.
                <br />
                Open Market work doesn&apos;t register here.
              </p>
            </div>
          ) : (
            <div className="flex max-h-[440px] flex-col gap-1.5 overflow-y-auto pr-1">
              {activeClients.map((row, i) => (
                <ClientRow
                  key={row.clientId}
                  row={row}
                  simNow={simNow}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
