import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc.js";
import { formatCash, formatSimDateTime } from "../../lib/formatters.js";
import { AirportPicker } from "./AirportPicker.js";
import { RouteMap } from "../../components/map/RouteMap.js";

type TabKey = "pilot" | "aircraft" | "pilot_aircraft";

const TABS: { key: TabKey; label: string; sub: string }[] = [
  {
    key: "pilot",
    label: "Travel myself",
    sub: "Commercial flight. Aircraft stay where they are.",
  },
  {
    key: "aircraft",
    label: "Move an aircraft",
    sub: "Contract pilot moves your aircraft. You stay put.",
  },
  {
    key: "pilot_aircraft",
    label: "Travel with an aircraft",
    sub: "Ride along with a contract pilot ferrying your aircraft.",
  },
];

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}

function CornerTicks() {
  return (
    <>
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />
    </>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3 3 L13 13 M13 3 L3 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function formatCostInline(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function TravelPanel({
  onClose,
  presetDestinationIcao,
}: {
  onClose: () => void;
  presetDestinationIcao?: string | null;
}) {
  useEscape(onClose);

  const utils = trpc.useUtils();
  const career = trpc.career.get.useQuery();
  const airports = trpc.airports.icaoOptions.useQuery();
  const ownedForTransfer = trpc.travel.listOwnedForTransfer.useQuery();

  const owned = ownedForTransfer.data ?? [];
  const ownedAtMyLocation = owned.filter(
    (a) => a.currentLocationIcao === career.data?.currentLocationIcao,
  );

  const [tab, setTab] = useState<TabKey>("pilot");
  const [destination, setDestination] = useState<string | null>(
    presetDestinationIcao ?? null,
  );
  const [aircraftId, setAircraftId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Smart default: when this panel was deep-linked and the player has one
  // owned aircraft already at their current airport, switch to the
  // "travel with aircraft" tab and preselect that plane. The ref guards
  // against re-firing once the user manually changes tabs.
  const smartDefaultApplied = useRef(false);
  useEffect(() => {
    if (smartDefaultApplied.current) return;
    if (!presetDestinationIcao) return;
    if (!ownedForTransfer.data || !career.data) return;
    smartDefaultApplied.current = true;
    if (owned.length === 1 && ownedAtMyLocation.length === 1) {
      setTab("pilot_aircraft");
      setAircraftId(ownedAtMyLocation[0]!.id);
    }
  }, [
    presetDestinationIcao,
    ownedForTransfer.data,
    career.data,
    owned,
    ownedAtMyLocation,
  ]);

  // Tab change refreshes the destination preset and clears errors. Aircraft
  // selection is intentionally NOT cleared: tabs that don't use it ignore it
  // and StrictMode's double-invoke would otherwise clobber the smart-default
  // preselection. Switching to a tab where the aircraft is invalid (e.g.
  // pilot_aircraft requires the aircraft to be at the player's location)
  // just leaves selectedAircraft computed as null.
  useEffect(() => {
    setDestination(presetDestinationIcao ?? null);
    setError(null);
  }, [tab, presetDestinationIcao]);

  // For pilot_aircraft, aircraft must be at the player's current location
  const aircraftPool = tab === "pilot_aircraft" ? ownedAtMyLocation : owned;
  const selectedAircraft = aircraftPool.find((a) => a.id === aircraftId) ?? null;

  const previewEnabled =
    !!destination &&
    (tab === "pilot" ? true : selectedAircraft != null) &&
    !!career.data;

  const previewQuery = trpc.travel.preview.useQuery(
    {
      type: tab,
      destinationIcao: destination ?? "",
      ownedAircraftId: selectedAircraft?.id,
    },
    { enabled: previewEnabled },
  );

  const executeMutation = trpc.travel.execute.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.career.get.invalidate();
        utils.jobs.list.invalidate();
        utils.jobs.listWithReachability.invalidate();
        utils.travel.listOwnedForTransfer.invalidate();
        onClose();
      } else {
        setError(result.error);
      }
    },
    onError: (err) => setError(err.message),
  });

  const previewData = previewQuery.data;
  const previewError =
    previewData && !previewData.ok ? previewData.error : null;
  const preview = previewData && previewData.ok ? previewData.preview : null;

  const cashCents = career.data?.cash ?? 0;
  const insufficient =
    preview != null && preview.estimate.costCents > cashCents;

  const canConfirm =
    preview != null &&
    !insufficient &&
    !executeMutation.isPending &&
    !previewQuery.isFetching;

  const onConfirm = () => {
    if (!preview || !destination) return;
    setError(null);
    executeMutation.mutate({
      type: tab,
      destinationIcao: destination,
      ownedAircraftId: selectedAircraft?.id,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-[min(960px,90vw)] flex-col overflow-hidden rounded-sm border border-ink-600 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CornerTicks />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-ink-600 px-6 pt-5 pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
              Travel · TRV
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-text-high">
              Travel &amp; Repositioning
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-ink-600 bg-ink-850">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  "relative flex flex-1 flex-col items-start gap-1 px-5 py-3 text-left transition-colors",
                  active
                    ? "bg-amber-glow/[0.05] text-text-high"
                    : "text-muted-dim hover:bg-ink-750/50 hover:text-text",
                ].join(" ")}
              >
                <span className="font-mono text-[12px] uppercase tracking-callsign">
                  {t.label}
                </span>
                <span className="text-tiny text-muted-dim">{t.sub}</span>
                {active && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-amber-glow" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden bg-ink-600">
          {/* Left: input */}
          <div className="flex flex-col gap-5 overflow-y-auto bg-ink-800 p-6">
            {tab !== "pilot" && (
              <div className="flex flex-col gap-2">
                <span className="label">Aircraft</span>
                {aircraftPool.length === 0 ? (
                  <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-3 text-tiny text-muted">
                    {tab === "pilot_aircraft" ? (
                      <>
                        No owned aircraft at your current location. Use{" "}
                        <span className="text-amber-glow">"Move an aircraft"</span>{" "}
                        to bring one here, or{" "}
                        <span className="text-amber-glow">"Travel myself"</span>{" "}
                        to commercial-fly to your aircraft.
                      </>
                    ) : (
                      <>You don't own any aircraft yet.</>
                    )}
                  </div>
                ) : (
                  <select
                    value={aircraftId ?? ""}
                    onChange={(e) =>
                      setAircraftId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full rounded-sm border border-ink-600 bg-ink-750 px-3 py-2 font-mono text-[13px] text-text-high outline-none focus:border-amber-deep"
                  >
                    <option value="">Select an aircraft…</option>
                    {aircraftPool.map((a) => {
                      const unavailable = a.status !== "available";
                      const suffix = unavailable
                        ? ` · ${a.status.replace("_", " ").toUpperCase()}`
                        : "";
                      return (
                        <option
                          key={a.id}
                          value={a.id}
                          disabled={unavailable}
                        >
                          {a.tailNumber} · {a.manufacturer} {a.model} · @{" "}
                          {a.currentLocationIcao} ({a.currentLocationName})
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="label">Origin</span>
              <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-2">
                {tab === "pilot" ? (
                  <>
                    <span className="icao text-text-high">
                      {career.data?.currentLocationIcao ?? "—"}
                    </span>
                    <span className="ml-3 text-tiny text-muted">
                      {career.data?.currentLocationName ?? ""}
                    </span>
                  </>
                ) : selectedAircraft ? (
                  <>
                    <span className="icao text-text-high">
                      {selectedAircraft.currentLocationIcao}
                    </span>
                    <span className="ml-3 text-tiny text-muted">
                      {selectedAircraft.currentLocationName}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-tiny text-muted-dim">
                    Select an aircraft to set origin
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="label">Destination</span>
              {airports.data ? (
                <AirportPicker
                  options={airports.data}
                  value={destination}
                  onChange={setDestination}
                  excludeIcao={
                    tab === "pilot"
                      ? career.data?.currentLocationIcao
                      : selectedAircraft?.currentLocationIcao
                  }
                />
              ) : (
                <div className="rounded-sm border border-ink-600 bg-ink-750 px-3 py-2 text-tiny text-muted-dim">
                  Loading airports…
                </div>
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex flex-col overflow-y-auto bg-ink-800 p-6">
            {!previewEnabled && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
                  preview · idle
                </div>
                <div className="max-w-xs text-sm text-muted">
                  {tab === "pilot"
                    ? "Choose a destination to preview the trip."
                    : "Choose an aircraft and a destination to preview the trip."}
                </div>
              </div>
            )}

            {previewEnabled && previewQuery.isFetching && !preview && (
              <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
                computing…
              </div>
            )}

            {previewError && (
              <div className="rounded-sm border border-urgency-critical/50 bg-urgency-critical/[0.06] px-3 py-3 text-sm text-urgency-critical">
                {previewError}
              </div>
            )}

            {preview && (
              <div className="flex flex-col gap-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                    Travel to
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="icao text-2xl text-text-high">
                      {preview.destinationIcao}
                    </span>
                    <span className="text-sm text-muted">
                      {preview.destinationName}
                    </span>
                  </div>
                </div>

                <RouteMap
                  height={140}
                  paddingPx={28}
                  airports={[
                    {
                      icao: preview.originIcao,
                      lat: preview.originLat,
                      lon: preview.originLon,
                      label: preview.originIcao,
                      marker: "origin",
                    },
                    {
                      icao: preview.destinationIcao,
                      lat: preview.destinationLat,
                      lon: preview.destinationLon,
                      label: preview.destinationIcao,
                      marker: "destination",
                    },
                  ]}
                  routes={[
                    {
                      fromIcao: preview.originIcao,
                      toIcao: preview.destinationIcao,
                      style: "solid",
                    },
                  ]}
                />

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-sm border border-ink-600 bg-ink-750 p-4">
                  <div className="flex flex-col">
                    <span className="label">Distance</span>
                    <span className="font-mono tabular-nums text-text-high">
                      {preview.distanceNm.toLocaleString()}{" "}
                      <span className="text-muted-dim">nm</span>
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="label">Cost</span>
                    <span className="font-mono tabular-nums text-amber-warm">
                      {formatCostInline(preview.estimate.costCents)}
                    </span>
                  </div>

                  <div className="col-span-2 rounded-sm border border-amber-deep/40 bg-amber-glow/[0.05] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
                          Sim time advances
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-amber-glow">
                        {formatDuration(preview.estimate.durationMinutes)}
                      </span>
                    </div>
                    {career.data && (
                      <div className="mt-2 grid grid-cols-2 gap-x-3 text-tiny text-muted">
                        <div className="flex flex-col">
                          <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                            Now
                          </span>
                          <span className="font-mono tabular-nums text-text">
                            {formatSimDateTime(career.data.simDateTime)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                            Arrival
                          </span>
                          <span className="font-mono tabular-nums text-text-high">
                            {formatSimDateTime(preview.willArriveAt)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
                  <div className="flex items-center gap-2">
                    <span className="label">Cost breakdown</span>
                    <span className="h-px flex-1 bg-ink-600" />
                  </div>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {preview.estimate.costBreakdown.map((line, i) => (
                      <li
                        key={i}
                        className="flex items-baseline justify-between font-mono text-[12px]"
                      >
                        <span className="text-muted">· {line.label}</span>
                        <span className="tabular-nums text-text-high">
                          {formatCostInline(line.amountCents)}
                        </span>
                      </li>
                    ))}
                    <li className="mt-2 flex items-baseline justify-between border-t border-ink-600 pt-2 font-mono text-[12px]">
                      <span className="uppercase tracking-callsign text-muted-dim">
                        Total
                      </span>
                      <span className="tabular-nums text-amber-warm">
                        {formatCostInline(preview.estimate.costCents)}
                      </span>
                    </li>
                  </ul>
                </div>

                {preview.estimate.aircraftHoursAccrued > 0 && (
                  <div className="grid grid-cols-2 gap-x-6 rounded-sm border border-ink-600 bg-ink-750 p-4 font-mono text-[12px]">
                    <div className="flex flex-col">
                      <span className="label">Airframe hrs added</span>
                      <span className="tabular-nums text-text-high">
                        {preview.estimate.aircraftHoursAccrued.toFixed(2)} h
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="label">Fuel burned</span>
                      <span className="tabular-nums text-text-high">
                        {preview.estimate.fuelGallonsBurned.toFixed(1)} gal
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-ink-600 bg-ink-850 px-6 py-4">
          <div className="flex flex-col font-mono text-tiny text-muted-dim">
            <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
              Cash on hand
            </span>
            <span className="text-amber-glow">{formatCash(cashCents)}</span>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <span className="font-mono text-tiny text-urgency-critical">
                {error}
              </span>
            )}
            {insufficient && preview && (
              <span className="font-mono text-tiny text-urgency-critical">
                Insufficient funds (need{" "}
                {formatCostInline(preview.estimate.costCents - cashCents)} more)
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-ink-600 bg-ink-750 px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:text-text-high"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={onConfirm}
              className="rounded-sm border border-amber-deep bg-amber-glow/[0.08] px-5 py-2 font-mono text-[11px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:opacity-40"
            >
              {executeMutation.isPending ? "Booking…" : "Confirm travel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

