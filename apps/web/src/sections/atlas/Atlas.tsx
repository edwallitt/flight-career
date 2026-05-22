import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc.js";
import {
  AtlasMap,
  chooseFuelOverlayType,
  computeFuelPriceRange,
  type AtlasData,
  type AtlasFeatureRef,
  type AtlasJobColorBy,
  type AtlasJobFilters,
  type AtlasJobFitStatus,
  type AtlasLayerSet,
  type AtlasRangeAnchor,
  type AtlasTrackedPosition,
} from "../../components/map/AtlasMap.js";
import { AtlasLegend } from "./AtlasLegend.js";
import { LayerPanel } from "./LayerPanel.js";
import { FeatureDrawer } from "./FeatureDrawer.js";
import { JobsFilterPanel } from "./JobsFilterPanel.js";
import { SearchBox, type AtlasSearchHit } from "./SearchBox.js";

const DEFAULT_LAYERS: AtlasLayerSet = {
  airports: true,
  fuelPrices: false,
  ownedAircraft: true,
  recentFlights: true,
  jobs: false,
  playerLocation: true,
  trackedFlight: true,
  // Range rings + dim are on by default — they're the headline change that
  // turns the atlas from inventory into a planning tool. Players who want a
  // neutral map can drop both via the layer panel.
  rangeRings: true,
  reachabilityDim: true,
  nightShade: true,
};

const DEFAULT_JOB_FILTERS: AtlasJobFilters = {
  distanceNm: { min: 0, max: 800 },
  classes: ["any"],
};

export function Atlas() {
  const navigate = useNavigate();
  // Atlas data drives all map state. activeTrackedFlight is the single signal
  // that an MSFS-tracked flight is in progress — the server only populates it
  // when career.trackingMode === 'tracked' AND active state is in_progress.
  // We bump the refetch cadence in that mode so the route line / completion
  // surface appear quickly; otherwise it stays slow. No bridge-status poll
  // here — that would burn cycles when MSFS is disabled or the player is in
  // a manual flight, neither of which can produce live data to display.
  const [isTracking, setIsTracking] = useState(false);
  const dataQuery = trpc.atlas.getData.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: isTracking ? 5_000 : 30_000,
    refetchOnWindowFocus: false,
  });

  const [layers, setLayers] = useState<AtlasLayerSet>(DEFAULT_LAYERS);
  const [jobFilters, setJobFilters] =
    useState<AtlasJobFilters>(DEFAULT_JOB_FILTERS);
  const [jobColorBy, setJobColorBy] = useState<AtlasJobColorBy>("role");

  // Fit data is only fetched when actually needed (color-by=fit AND jobs
  // layer on). The query is cheap server-side but adds an extra refetch
  // cadence the player doesn't pay for unless they're using the mode.
  const fitQuery = trpc.jobs.listWithReachability.useQuery(undefined, {
    enabled: jobColorBy === "fit" && layers.jobs,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const jobFitById = useMemo<ReadonlyMap<number, AtlasJobFitStatus> | undefined>(
    () => {
      if (jobColorBy !== "fit" || !fitQuery.data) return undefined;
      const m = new Map<number, AtlasJobFitStatus>();
      for (const j of fitQuery.data.jobs) {
        m.set(j.id, j.fit.status as AtlasJobFitStatus);
      }
      return m;
    },
    [jobColorBy, fitQuery.data],
  );
  const [visibleJobsCount, setVisibleJobsCount] = useState(0);
  const [selected, setSelected] = useState<AtlasFeatureRef | null>(null);
  // Search-box flyTo target. `key` bumps so retriggering on the same
  // coordinates re-runs the AtlasMap effect.
  const [focusPoint, setFocusPoint] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    key: number;
  } | null>(null);

  const handleSearchSelect = useCallback((hit: AtlasSearchHit) => {
    if (hit.type === "airport") {
      setSelected({ type: "airport", icao: hit.icao });
    } else {
      setSelected({ type: "aircraft", id: hit.id });
    }
    setFocusPoint({ lat: hit.lat, lon: hit.lon, zoom: 7, key: Date.now() });
  }, []);

  // Track whether we auto-disabled Recent Flights so we can offer to undo it.
  const [recentAutoDisabled, setRecentAutoDisabled] = useState(false);
  const prevJobsOn = useRef(layers.jobs);

  const rawData: AtlasData | null = dataQuery.data ?? null;
  const activeTracked = rawData?.activeTrackedFlight ?? null;

  // Mirror activeTracked into `isTracking` so the next refetch interval picks
  // up the faster cadence. Done in an effect rather than during render so
  // react-query's `refetchInterval` option sees a stable value across renders.
  useEffect(() => {
    setIsTracking(activeTracked != null);
  }, [activeTracked]);

  // Live aircraft state — only polled when there's an in-progress tracked
  // flight. We split this off from atlas.getData so the heavy query keeps its
  // 30s cadence; the cheap currentState() poll drives the moving marker.
  const bridgeState = trpc.simBridge.currentState.useQuery(undefined, {
    enabled: activeTracked != null,
    refetchInterval: 1_000,
    refetchOnWindowFocus: false,
  });

  const trackedPosition: AtlasTrackedPosition | null = useMemo(() => {
    if (!activeTracked || !bridgeState.data) return null;
    const s = bridgeState.data;
    return {
      lat: s.positionLat,
      lon: s.positionLon,
      headingDeg: s.trueHeadingDeg,
      altitudeFt: s.altitudeFt,
      groundSpeedKts: s.groundSpeedKts,
      onGround: s.onGround,
    };
  }, [activeTracked, bridgeState.data]);

  // The dispatched owned aircraft is rendered as the moving tracked marker.
  // Hide it from the owned-aircraft layer so it doesn't simultaneously sit at
  // the origin airport (ownedAircraft.currentLocationIcao isn't updated until
  // completion). Other owned aircraft still render normally.
  const data: AtlasData | null = useMemo(() => {
    if (!rawData) return null;
    if (!activeTracked || activeTracked.ownedAircraftId == null) return rawData;
    return {
      ...rawData,
      ownedAircraft: rawData.ownedAircraft.filter(
        (a) => a.id !== activeTracked.ownedAircraftId,
      ),
    };
  }, [rawData, activeTracked]);

  // When the player toggles Open Jobs ON and Recent Flights is currently ON,
  // auto-disable Recent Flights (with a friendly notice). When the player
  // toggles Open Jobs OFF, restore the prior visibility.
  useEffect(() => {
    if (layers.jobs && !prevJobsOn.current) {
      // jobs just turned on
      if (layers.recentFlights) {
        setLayers((prev) => ({ ...prev, recentFlights: false }));
        setRecentAutoDisabled(true);
      }
    } else if (!layers.jobs && prevJobsOn.current) {
      // jobs just turned off — clear the auto-disable flag (player can re-enable manually)
      setRecentAutoDisabled(false);
    }
    prevJobsOn.current = layers.jobs;
  }, [layers.jobs, layers.recentFlights]);

  const counts = useMemo(() => {
    if (!data) {
      return {
        airports: 0,
        ownedAircraft: 0,
        recentFlights: 0,
        jobs: 0,
        player: 0,
      };
    }
    return {
      airports: data.airports.length,
      ownedAircraft: data.ownedAircraft.length,
      recentFlights: data.recentFlights.length,
      jobs: data.jobs.length,
      player: data.player ? 1 : 0,
    };
  }, [data]);

  // Display the filter visible count when jobs layer is on, otherwise the
  // unfiltered total — that's what the layer panel chip should show.
  const jobsBadgeCount = layers.jobs ? visibleJobsCount : counts.jobs;

  const fuelOverlayType = useMemo(
    () => (data ? chooseFuelOverlayType(data.ownedAircraft) : "jet-a"),
    [data],
  );
  const fuelOverlayRange = useMemo(
    () => (data ? computeFuelPriceRange(data.airports, fuelOverlayType) : null),
    [data, fuelOverlayType],
  );

  // Planning override: the player can pin the range overlay to a different
  // location ("if I were at CYHZ…") or aircraft ("if I dispatched my
  // Bonanza…"). Two distinct overrides because the hypothetical question
  // and its answer are different — an airport override needs an aircraft
  // to source range from, while an aircraft override implies its current
  // location. Cleared by the chip on the map. Persists across data
  // refetches but not across full reloads — this is a working surface,
  // not a saved view.
  const [anchorOverride, setAnchorOverride] = useState<
    | { type: "airport"; icao: string }
    | { type: "aircraft"; id: number }
    | null
  >(null);

  // Range anchor: derived from override (when set) or the default rule —
  // longest-range *available* aircraft sitting at the player's airport. An
  // aircraft in maintenance / in-flight / committed can't be dispatched
  // right now, so its range would be misleading. If neither produces a
  // valid anchor the rings disappear and dim is suppressed.
  const rangeAnchor: AtlasRangeAnchor | null = useMemo(() => {
    if (!data) return null;

    if (anchorOverride?.type === "aircraft") {
      const ac = data.ownedAircraft.find((a) => a.id === anchorOverride.id);
      if (!ac) return null;
      return {
        lat: ac.lat,
        lon: ac.lon,
        rangeNm: ac.rangeNm,
        cruiseSpeedKts: ac.cruiseSpeedKts,
        tailNumber: ac.tailNumber,
        aircraftTypeLabel: ac.aircraftTypeLabel,
        isOverride: true,
      };
    }
    if (anchorOverride?.type === "airport") {
      // Planning from a hypothetical airport: project the *best owned
      // aircraft anywhere in the fleet* onto that airport. We deliberately
      // drop the "available / at player loc" filter — the question being
      // asked is structural ("what could this airport reach with my best
      // plane?") rather than operational ("what can I dispatch right now?").
      const ap = data.airports.find((a) => a.icao === anchorOverride.icao);
      if (!ap || data.ownedAircraft.length === 0) return null;
      const best = data.ownedAircraft.reduce((a, b) =>
        b.rangeNm > a.rangeNm ? b : a,
      );
      return {
        lat: ap.lat,
        lon: ap.lon,
        rangeNm: best.rangeNm,
        cruiseSpeedKts: best.cruiseSpeedKts,
        tailNumber: best.tailNumber,
        aircraftTypeLabel: best.aircraftTypeLabel,
        isOverride: true,
      };
    }

    if (!data.player) return null;
    const here = data.ownedAircraft.filter(
      (a) =>
        a.status === "available" &&
        a.currentLocationIcao === data.player!.currentLocationIcao,
    );
    if (here.length === 0) return null;
    const best = here.reduce((a, b) => (b.rangeNm > a.rangeNm ? b : a));
    return {
      lat: data.player.lat,
      lon: data.player.lon,
      rangeNm: best.rangeNm,
      cruiseSpeedKts: best.cruiseSpeedKts,
      tailNumber: best.tailNumber,
      aircraftTypeLabel: best.aircraftTypeLabel,
    };
  }, [data, anchorOverride]);

  // Chip label for the override banner. Centralized so the chip + drawer
  // wording stay synchronized — "Planning from CYHZ" must match the
  // mental model of the click that produced it.
  const overrideLabel = useMemo<string | null>(() => {
    if (!anchorOverride || !data) return null;
    if (anchorOverride.type === "airport") {
      return `Planning from ${anchorOverride.icao}`;
    }
    const ac = data.ownedAircraft.find((a) => a.id === anchorOverride.id);
    return ac ? `Planning with ${ac.tailNumber}` : "Planning override";
  }, [anchorOverride, data]);

  const setAirportAnchor = useCallback((icao: string) => {
    setAnchorOverride({ type: "airport", icao });
  }, []);
  const setAircraftAnchor = useCallback((id: number) => {
    setAnchorOverride({ type: "aircraft", id });
  }, []);
  const clearAnchorOverride = useCallback(() => {
    setAnchorOverride(null);
  }, []);

  const handleFilteredJobsChange = useCallback((n: number) => {
    setVisibleJobsCount(n);
  }, []);

  const undoAutoDisable = () => {
    setLayers((prev) => ({ ...prev, recentFlights: true }));
    setRecentAutoDisabled(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-850">
      {/* Section header — kept lean: breadcrumb, heading, live pill. */}
      <div className="flex items-center justify-between border-b border-ink-600 bg-ink-800 px-6 py-3.5">
        <div className="flex items-baseline gap-4">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · Map
          </div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text-high">
            Atlas
          </h1>
        </div>

        <div className="flex items-center gap-2 rounded-sm border border-amber-deep/40 bg-amber-glow/[0.05] px-2 py-1 font-mono text-[10px] uppercase tracking-callsign text-amber-glow">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/50" />
            <span className="relative h-2 w-2 rounded-full bg-amber-glow" />
          </span>
          {dataQuery.isPending
            ? "Acquiring…"
            : isTracking
              ? "Tracking · 5s"
              : "Live · 30s"}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex w-[236px] shrink-0 flex-col overflow-y-auto border-r border-ink-600 bg-ink-800">
          {/* Search lives at the very top of the panel — first stop on the
              left edge for any "find me X" intent. Pressing "/" anywhere on
              the page focuses it. */}
          {data && (
            <div className="border-b border-ink-600/70 px-3 py-3">
              <SearchBox
                airports={data.airports}
                ownedAircraft={data.ownedAircraft}
                onSelect={handleSearchSelect}
              />
            </div>
          )}
          <LayerPanel
            layers={layers}
            onChange={setLayers}
            counts={{ ...counts, jobs: jobsBadgeCount }}
            fuelOverlayType={fuelOverlayType}
            fuelOverlayRange={fuelOverlayRange}
            hasTrackedFlight={activeTracked != null}
            rangeAnchor={rangeAnchor}
          />
          {layers.jobs && data && (
            <JobsFilterPanel
              filters={jobFilters}
              onChange={setJobFilters}
              visibleJobs={visibleJobsCount}
              totalJobs={counts.jobs}
              recentFlightsAutoDisabled={recentAutoDisabled}
              onUndoAutoDisable={undoAutoDisable}
              colorBy={jobColorBy}
              onColorByChange={setJobColorBy}
              fitDataLoading={
                jobColorBy === "fit" && fitQuery.isPending
              }
              isPlanningOverride={anchorOverride != null}
            />
          )}
        </div>

        <div className="relative flex-1">
          {data && (
            <AtlasMap
              data={data}
              visibleLayers={layers}
              jobFilters={layers.jobs ? jobFilters : undefined}
              onFilteredJobsChange={handleFilteredJobsChange}
              selectedFeature={selected}
              onFeatureClick={setSelected}
              fuelOverlayType={fuelOverlayType}
              trackedPosition={trackedPosition}
              rangeAnchor={rangeAnchor}
              focusPoint={focusPoint}
              jobColorBy={jobColorBy}
              jobFitById={jobFitById}
            />
          )}
          {/* Override chip — surfaces the active planning anchor and offers
              a one-click clear. Sits at the top-center of the map so it
              doesn't fight the OPS badge (top-left) or the layer tally
              (top-right). pointer-events-auto on the inner element only,
              so the chip itself is interactive but the strip around it
              still lets map drag pass through. */}
          {data && overrideLabel && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-sm border border-amber-deep/60 bg-amber-glow/[0.10] px-3 py-1 font-mono text-[10px] uppercase tracking-callsign text-amber-glow backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_5px_rgba(212,165,116,0.7)]" />
                {overrideLabel}
                {rangeAnchor && (
                  <span className="text-muted-faint">
                    · {rangeAnchor.tailNumber} ·{" "}
                    <span className="tabular-nums text-amber-warm">
                      {rangeAnchor.rangeNm.toLocaleString()} nm
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Clear planning anchor"
                  onClick={clearAnchorOverride}
                  className="ml-1 rounded-sm border border-amber-deep/60 px-1 text-amber-glow hover:bg-amber-glow/[0.15]"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {!data && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              {dataQuery.isError ? "Failed to load atlas" : "Loading atlas…"}
            </div>
          )}
          {/* Contextual legend. Sits above the scale bar (which lives at
             bottom-4 left-4 inside AtlasMap) so the two don't stack
             awkwardly. The legend handles its own collapsed/expanded state
             and renders nothing when no layer-driven section applies. */}
          {data && (
            <div className="pointer-events-none absolute bottom-14 left-4 z-10">
              <AtlasLegend
                layers={layers}
                fuelOverlayType={fuelOverlayType}
                fuelOverlayRange={fuelOverlayRange}
                hasTrackedFlight={activeTracked != null}
                hasFerryJobs={data.jobs.some((j) => j.jobType === "ferry")}
              />
            </div>
          )}
        </div>

        <FeatureDrawer
          feature={selected}
          data={data}
          activeOverride={anchorOverride}
          onClose={() => setSelected(null)}
          onNavigate={(path) => {
            setSelected(null);
            navigate(path);
          }}
          onSetAirportAnchor={setAirportAnchor}
          onSetAircraftAnchor={setAircraftAnchor}
          onClearAnchor={clearAnchorOverride}
        />
      </div>
    </div>
  );
}
