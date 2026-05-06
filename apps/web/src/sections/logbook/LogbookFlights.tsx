import { useMemo, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";
import { DropdownChip } from "./DropdownChip.js";
import { FlightDrawer } from "./FlightDrawer.js";
import { RouteCell } from "./RouteCell.js";

type DateRangeKey = "all" | "7d" | "30d";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

function formatBlock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatCompactDate(ms: number): string {
  return formatSimDateTime(ms).replace(/ AT$/, "");
}

function NetCell({ cents }: { cents: number }) {
  const sign = cents >= 0 ? "+" : "−";
  const tone = cents >= 0 ? "text-emerald-300" : "text-urgency-critical";
  return (
    <span className={`tabular-nums ${tone}`}>
      {sign}
      {formatCash(Math.abs(cents))}
    </span>
  );
}

function RowChevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      className="text-muted-dim transition-colors group-hover:text-amber-glow"
      aria-hidden
    >
      <path
        d="M5 3 L9 7 L5 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function LogbookFlights() {
  const [aircraftKey, setAircraftKey] = useState<string>("all");
  const [clientId, setClientId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRangeKey>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const careerQuery = trpc.career.get.useQuery();
  const filterOptionsQuery = trpc.logbook.filterOptions.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const simNow = careerQuery.data?.simDateTime ?? Date.now();

  const dateFrom = useMemo(() => {
    if (dateRange === "all") return undefined;
    if (dateRange === "7d") return simNow - 7 * SIM_DAY_MS;
    return simNow - 30 * SIM_DAY_MS;
  }, [dateRange, simNow]);

  const filterPayload = useMemo(() => {
    const f: Record<string, number | string> = { limit: 200 };
    if (aircraftKey !== "all") {
      const opt = filterOptionsQuery.data?.aircraft.find(
        (a) => a.key === aircraftKey,
      );
      if (opt?.source === "owned" && opt.ownedAircraftId != null) {
        f.filterByOwnedAircraftId = opt.ownedAircraftId;
      } else if (opt?.source === "rental" && opt.rentalAircraftTypeId) {
        f.filterByRentalAircraftTypeId = opt.rentalAircraftTypeId;
      }
    }
    if (clientId !== "all") f.filterByClientId = clientId;
    if (dateFrom != null) f.filterByDateFrom = dateFrom;
    return f;
  }, [aircraftKey, clientId, dateFrom, filterOptionsQuery.data]);

  const flightsQuery = trpc.logbook.flights.useQuery(filterPayload, {
    refetchInterval: 30_000,
  });

  const rows = flightsQuery.data?.rows ?? [];
  const total = flightsQuery.data?.total ?? 0;
  const drawerOpen = selectedId != null;

  const aircraftOptions = [
    { value: "all", label: "All aircraft" },
    ...(filterOptionsQuery.data?.aircraft ?? []).map((a) => ({
      value: a.key,
      label: a.label,
    })),
  ];
  const clientOptions = [
    { value: "all", label: "All clients" },
    ...(filterOptionsQuery.data?.clients ?? []).map((c) => ({
      value: c.id,
      label: c.name,
    })),
  ];

  const filtersActive =
    aircraftKey !== "all" || clientId !== "all" || dateRange !== "all";

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Filter strip */}
        <div className="flex items-end gap-6 border-b border-ink-600 bg-ink-800 px-6 py-3">
          <DropdownChip
            label="Aircraft"
            value={aircraftKey}
            options={aircraftOptions}
            onChange={setAircraftKey}
            width={220}
          />
          <DropdownChip
            label="Client"
            value={clientId}
            options={clientOptions}
            onChange={setClientId}
            width={220}
          />

          <div className="flex flex-col gap-1.5">
            <span className="label">Range</span>
            <div className="flex rounded-sm border border-ink-600 bg-ink-750">
              {(
                [
                  { key: "7d", label: "7d" },
                  { key: "30d", label: "30d" },
                  { key: "all", label: "All" },
                ] as const
              ).map((opt) => {
                const active = dateRange === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setDateRange(opt.key)}
                    className={[
                      "px-3 py-1.5 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                      active
                        ? "bg-amber-glow/[0.10] text-amber-glow"
                        : "text-muted hover:text-text-high",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto flex flex-col items-end gap-1.5 font-mono text-tiny">
            <span className="label">Showing</span>
            <span className="tabular-nums text-text-high">
              {flightsQuery.isPending
                ? "···"
                : `${total.toString().padStart(2, "0")} flight${total === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {/* Table */}
        <div
          className="relative flex-1 overflow-y-auto transition-[padding] duration-200"
          style={{ paddingRight: drawerOpen ? 460 : 0 }}
        >
          {flightsQuery.isPending ? (
            <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              loading flights…
            </div>
          ) : rows.length === 0 ? (
            <EmptyFlights filtered={filtersActive} />
          ) : (
            <table className="w-full table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10 border-b border-ink-600 bg-ink-850">
                <tr className="text-left">
                  <Th className="w-[160px]">Date</Th>
                  <Th className="w-[180px]">Route</Th>
                  <Th>Aircraft</Th>
                  <Th>Client</Th>
                  <Th className="w-[80px] text-right">Block</Th>
                  <Th className="w-[100px] text-right">Pay</Th>
                  <Th className="w-[110px] text-right">Net</Th>
                  <Th className="w-[44px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = selectedId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() =>
                        setSelectedId((prev) => (prev === r.id ? null : r.id))
                      }
                      className={[
                        "group cursor-pointer border-b border-ink-700/60 transition-colors",
                        isSelected
                          ? "bg-amber-glow/[0.06]"
                          : "hover:bg-ink-800/60",
                      ].join(" ")}
                    >
                      <Td className="font-mono tabular-nums text-text">
                        {formatCompactDate(r.startedAt)}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <RouteCell
                            origin={r.originIcao}
                            destination={r.destinationIcao}
                          />
                          {r.isDiversion && (
                            <span className="rounded-sm border border-urgency-urgent/60 bg-urgency-urgent/[0.10] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-callsign text-urgency-urgent">
                              DIV
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="truncate text-text">{r.aircraftLabel}</Td>
                      <Td className="truncate text-text">
                        {r.clientName ?? "—"}
                      </Td>
                      <Td className="text-right font-mono tabular-nums text-text">
                        {formatBlock(r.blockTimeMinutes)}
                      </Td>
                      <Td className="text-right font-mono tabular-nums text-amber-warm">
                        {formatCash(r.totalRevenue)}
                      </Td>
                      <Td className="text-right font-mono">
                        <NetCell cents={r.netCents} />
                      </Td>
                      <Td className="text-right">
                        <span
                          className={[
                            "inline-flex h-6 w-6 items-center justify-center rounded-sm border transition-colors",
                            isSelected
                              ? "border-amber-deep bg-amber-glow/[0.10] text-amber-glow"
                              : "border-ink-600 bg-ink-750 group-hover:border-amber-deep/60",
                          ].join(" ")}
                        >
                          <RowChevron />
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <FlightDrawer flightId={selectedId} onClose={() => setSelectedId(null)} />
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

function EmptyFlights({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative w-[460px] rounded-sm border border-ink-600 bg-ink-800/70 px-10 py-12 text-center">
        <span className="pointer-events-none absolute -left-px -top-px block h-3 w-3 border-l border-t border-amber-deep" />
        <span className="pointer-events-none absolute -right-px -top-px block h-3 w-3 border-r border-t border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -left-px block h-3 w-3 border-b border-l border-amber-deep" />
        <span className="pointer-events-none absolute -bottom-px -right-px block h-3 w-3 border-b border-r border-amber-deep" />

        <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
          Module · LOG
        </div>
        <div className="mt-3 font-display text-2xl font-semibold tracking-tight text-text-high">
          {filtered ? "No flights match these filters" : "No flights logged yet"}
        </div>
        <div className="mt-3 text-sm text-muted">
          {filtered
            ? "Adjust the filters above to see more entries."
            : "Accept a job from the dispatch board and complete it to start your logbook."}
        </div>
      </div>
    </div>
  );
}
