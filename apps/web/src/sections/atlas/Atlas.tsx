import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../trpc.js";
import {
  AtlasMap,
  type AtlasData,
  type AtlasFeatureRef,
  type AtlasJobFilters,
  type AtlasLayerSet,
} from "../../components/map/AtlasMap.js";
import { LayerPanel } from "./LayerPanel.js";
import { FeatureDrawer } from "./FeatureDrawer.js";
import { JobsFilterPanel } from "./JobsFilterPanel.js";

const DEFAULT_LAYERS: AtlasLayerSet = {
  airports: true,
  fuelPrices: false,
  ownedAircraft: true,
  recentFlights: true,
  jobs: false,
  playerLocation: true,
};

const DEFAULT_JOB_FILTERS: AtlasJobFilters = {
  distanceNm: { min: 0, max: 800 },
  classes: ["any"],
};

export function Atlas() {
  const navigate = useNavigate();
  const dataQuery = trpc.atlas.getData.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const [layers, setLayers] = useState<AtlasLayerSet>(DEFAULT_LAYERS);
  const [jobFilters, setJobFilters] =
    useState<AtlasJobFilters>(DEFAULT_JOB_FILTERS);
  const [visibleJobsCount, setVisibleJobsCount] = useState(0);
  const [selected, setSelected] = useState<AtlasFeatureRef | null>(null);

  // Track whether we auto-disabled Recent Flights so we can offer to undo it.
  const [recentAutoDisabled, setRecentAutoDisabled] = useState(false);
  const prevJobsOn = useRef(layers.jobs);

  const data: AtlasData | null = dataQuery.data ?? null;

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
          {dataQuery.isPending ? "Acquiring…" : "Live · 30s"}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex w-[236px] shrink-0 flex-col overflow-y-auto border-r border-ink-600 bg-ink-800">
          <LayerPanel
            layers={layers}
            onChange={setLayers}
            counts={{ ...counts, jobs: jobsBadgeCount }}
          />
          {layers.jobs && data && (
            <JobsFilterPanel
              filters={jobFilters}
              onChange={setJobFilters}
              visibleJobs={visibleJobsCount}
              totalJobs={counts.jobs}
              recentFlightsAutoDisabled={recentAutoDisabled}
              onUndoAutoDisable={undoAutoDisable}
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
            />
          )}
          {!data && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              {dataQuery.isError ? "Failed to load atlas" : "Loading atlas…"}
            </div>
          )}
        </div>

        <FeatureDrawer
          feature={selected}
          data={data}
          onClose={() => setSelected(null)}
          onNavigate={(path) => {
            setSelected(null);
            navigate(path);
          }}
        />
      </div>
    </div>
  );
}
