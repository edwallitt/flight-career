import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";

const TYPE_LABEL: Record<string, string> = {
  "100hr": "100-hour",
  annual: "Annual",
  overhaul: "Overhaul",
  unscheduled: "Unscheduled",
};

const TYPE_TONE: Record<string, string> = {
  "100hr": "border-sky-500/50 text-sky-300 bg-sky-500/[0.06]",
  annual: "border-amber-deep/60 text-amber-glow bg-amber-glow/[0.06]",
  overhaul: "border-urgency-urgent/50 text-urgency-urgent bg-urgency-urgent/[0.06]",
  unscheduled: "border-urgency-critical/50 text-urgency-critical bg-urgency-critical/[0.06]",
};

const STATUS_TONE: Record<string, string> = {
  in_progress: "border-amber-deep/60 text-amber-glow bg-amber-glow/[0.06]",
  completed: "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.06]",
  cancelled: "border-ink-600 text-muted-dim bg-ink-750",
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function LogbookMaintenance() {
  const query = trpc.logbook.maintenance.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const rows = query.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      {query.isPending ? (
        <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
          loading…
        </div>
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-10 border-b border-ink-600 bg-ink-850">
            <tr className="text-left">
              <Th className="w-[180px]">Date</Th>
              <Th>Aircraft</Th>
              <Th className="w-[140px]">Type</Th>
              <Th className="w-[120px]">Status</Th>
              <Th className="w-[120px] text-right">Cost</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink-700/60">
                <Td className="font-mono tabular-nums text-text">
                  {formatSimDateTime(r.startedAt)}
                </Td>
                <Td className="text-text">{r.aircraftLabel}</Td>
                <Td>
                  <span
                    className={[
                      "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign",
                      TYPE_TONE[r.type] ?? "",
                    ].join(" ")}
                  >
                    {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                </Td>
                <Td>
                  <span
                    className={[
                      "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-callsign",
                      STATUS_TONE[r.status] ?? "",
                    ].join(" ")}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </Td>
                <Td className="text-right font-mono tabular-nums text-urgency-critical">
                  −{formatCash(r.cost)}
                </Td>
                <Td className="truncate text-tiny text-muted">
                  {r.description}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={[
        "px-4 py-2.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={["px-4 py-3 align-middle text-[13px]", className ?? ""].join(
        " ",
      )}
    >
      {children}
    </td>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative w-[480px] rounded-sm border border-ink-600 bg-ink-800/70 px-10 py-12 text-center">
        <span className="pointer-events-none absolute -left-px -top-px block h-3 w-3 border-l border-t border-amber-deep" />
        <span className="pointer-events-none absolute -right-px -top-px block h-3 w-3 border-r border-t border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -left-px block h-3 w-3 border-b border-l border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -right-px block h-3 w-3 border-b border-r border-amber-deep" />

        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          Module · MNT
        </div>
        <div className="mt-3 font-display text-2xl font-semibold tracking-tight text-text-high">
          No maintenance events recorded
        </div>
        <div className="mt-3 text-sm text-muted">
          As your aircraft accumulate hours, scheduled maintenance will appear here.
        </div>
      </div>
    </div>
  );
}
