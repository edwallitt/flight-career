import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { trpc } from "../../trpc.js";
import { ActiveJobBanner } from "./ActiveJobBanner.js";
import { FleetStrip } from "./FleetStrip.js";
import { FuelShockBanner } from "./FuelShockBanner.js";
import { JobDrawer } from "./JobDrawer.js";
import { JobFilters } from "./JobFilters.js";
import { JobTable } from "./JobTable.js";
import { RecommendedJobCard } from "./RecommendedJobCard.js";
import type {
  FleetReadout,
  JobRow,
  OriginScope,
  RoleFilter,
  SortDir,
  SortKey,
  SortState,
} from "./types.js";

const EMPTY_FLEET: FleetReadout = {
  ownedHere: [],
  ownedElsewhere: 0,
  rentalsHere: [],
};

// Filter state is URL-as-source-of-truth: ?origin=here&role=bush&sort=expires:asc
// survives reloads, is shareable to teammates and screenshots, and lets the
// Atlas deep-link target a specific pre-filtered view of the board. Each
// param has a default — when the URL matches the default, we don't write the
// param back (keeps URLs short and avoids history churn for "I just clicked
// the default" interactions).
const DEFAULT_ORIGIN: OriginScope = "flyable";
const DEFAULT_ROLE: RoleFilter = "all";
const DEFAULT_SORT: SortState = { key: "payHour", dir: "desc" };

const VALID_ORIGIN: ReadonlyArray<OriginScope> = ["here", "flyable", "all"];
const VALID_ROLE: ReadonlyArray<RoleFilter> = [
  "all",
  "bush",
  "air_taxi",
  "light_jet",
  "open",
];
const VALID_SORT_KEY: ReadonlyArray<SortKey> = ["payHour", "distance", "expires"];

function parseOrigin(raw: string | null): OriginScope {
  return raw && (VALID_ORIGIN as readonly string[]).includes(raw)
    ? (raw as OriginScope)
    : DEFAULT_ORIGIN;
}
function parseRole(raw: string | null): RoleFilter {
  return raw && (VALID_ROLE as readonly string[]).includes(raw)
    ? (raw as RoleFilter)
    : DEFAULT_ROLE;
}
function parseSort(raw: string | null): SortState {
  if (!raw) return DEFAULT_SORT;
  const [key, dir] = raw.split(":");
  if (
    key &&
    dir &&
    (VALID_SORT_KEY as readonly string[]).includes(key) &&
    (dir === "asc" || dir === "desc")
  ) {
    return { key: key as SortKey, dir: dir as SortDir };
  }
  return DEFAULT_SORT;
}

export function JobBoard({ onOpenActiveJob }: { onOpenActiveJob: () => void }) {
  // URL is the source of truth for filters. setSearchParams is the one
  // setter we route everything through; React state is derived via useMemo
  // so we don't double-store anything.
  const [searchParams, setSearchParams] = useSearchParams();
  const roleFilter = useMemo(
    () => parseRole(searchParams.get("role")),
    [searchParams],
  );
  const originScope = useMemo(
    () => parseOrigin(searchParams.get("origin")),
    [searchParams],
  );
  const sort = useMemo(
    () => parseSort(searchParams.get("sort")),
    [searchParams],
  );

  // Writer that preserves any param we don't manage (jobId deep links,
  // future ?dev=1 etc.), strips defaults, and uses replace navigation so
  // every filter click doesn't pollute the back stack.
  const updateParams = useCallback(
    (
      patch: Partial<{
        origin: OriginScope;
        role: RoleFilter;
        sort: SortState;
      }>,
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.origin !== undefined) {
            if (patch.origin === DEFAULT_ORIGIN) next.delete("origin");
            else next.set("origin", patch.origin);
          }
          if (patch.role !== undefined) {
            if (patch.role === DEFAULT_ROLE) next.delete("role");
            else next.set("role", patch.role);
          }
          if (patch.sort !== undefined) {
            const isDefault =
              patch.sort.key === DEFAULT_SORT.key &&
              patch.sort.dir === DEFAULT_SORT.dir;
            if (isDefault) next.delete("sort");
            else next.set("sort", `${patch.sort.key}:${patch.sort.dir}`);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setRoleFilter = useCallback(
    (r: RoleFilter) => updateParams({ role: r }),
    [updateParams],
  );
  const setOriginScope = useCallback(
    (s: OriginScope) => updateParams({ origin: s }),
    [updateParams],
  );
  const setSort = useCallback(
    (s: SortState) => updateParams({ sort: s }),
    [updateParams],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Deep-link support: `?jobId=42` (used by the Atlas drawer's "View in Job
  // Board" button) selects that job on arrival and scrolls it into view. We
  // read-only on URL change — closing the drawer doesn't strip the param,
  // and selecting a different row doesn't write it back. That keeps deep
  // links idempotent and lets react-router stay in charge of history.
  const deepLinkJobId = useMemo(() => {
    const raw = searchParams.get("jobId");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);
  // Tracks the last id we honored so re-arrivals at the same URL don't keep
  // overriding the user's manual selection.
  const lastDeepLinkRef = useRef<number | null>(null);
  useEffect(() => {
    if (deepLinkJobId == null) return;
    if (lastDeepLinkRef.current === deepLinkJobId) return;
    lastDeepLinkRef.current = deepLinkJobId;
    setSelectedId(deepLinkJobId);
  }, [deepLinkJobId]);
  // Pause flag — set true while the player is hovering the table or has a
  // drawer open. While paused, the 10s refetch is suspended so rows don't
  // re-sort under the cursor mid-click.
  const [interactionPaused, setInteractionPaused] = useState(false);

  const utils = trpc.useUtils();
  const drawerOpen = selectedId != null;
  const list = trpc.jobs.listWithReachability.useQuery(undefined, {
    refetchInterval: interactionPaused || drawerOpen ? false : 10_000,
  });
  const career = trpc.career.get.useQuery();
  const tickNow = trpc.jobs.tickNow.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.listWithReachability.invalidate();
      utils.career.get.invalidate();
    },
  });
  const lastTick = tickNow.data;

  const allJobs: JobRow[] = list.data?.jobs ?? [];

  // After the list resolves with a deep-linked selection, scroll the matching
  // row into view. Runs once per (selectedId, jobs-loaded) pair — re-renders
  // for refetches don't keep yanking the viewport.
  const lastScrolledIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId == null || allJobs.length === 0) return;
    if (lastScrolledIdRef.current === selectedId) return;
    if (!allJobs.some((j) => j.id === selectedId)) return; // job not on the board (expired / filtered out)
    const node = document.querySelector(
      `[data-job-ids~="${selectedId}"]`,
    );
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      lastScrolledIdRef.current = selectedId;
    }
  }, [selectedId, allJobs]);

  const playerLocationIcao = list.data?.playerLocationIcao ?? "";
  const recommendedJobId = list.data?.recommendedJobId ?? null;
  const recommendedJob = useMemo(
    () =>
      recommendedJobId != null
        ? allJobs.find((j) => j.id === recommendedJobId) ?? null
        : null,
    [recommendedJobId, allJobs],
  );
  const fleet = list.data?.fleet ?? EMPTY_FLEET;
  const activeJob = list.data?.activeJob ?? null;
  // When the player is mid-flight, the recommendation card is captioned
  // with "after arrival at X" instead of "from your current location" —
  // matches the server-side pivot in pickRecommendedJobId.
  const recommendationOriginIcao =
    activeJob?.destinationIcao ?? playerLocationIcao;

  const filteredJobs = useMemo(() => {
    return allJobs.filter((j) => {
      // Role filter — ferries pass through unconditionally (they're a
      // job type, not a career role) so a player on "Bush" still sees the
      // ferry contract that drops them at their next pickup.
      if (roleFilter !== "all" && j.jobType !== "ferry" && j.role !== roleFilter) {
        return false;
      }
      // Origin scope.
      if (originScope === "here" && j.originIcao !== playerLocationIcao) {
        return false;
      }
      if (
        originScope === "flyable" &&
        j.fit.status !== "ready" &&
        j.fit.status !== "reposition"
      ) {
        return false;
      }
      return true;
    });
  }, [allJobs, roleFilter, originScope, playerLocationIcao]);

  // Sim time for relative-time formatting in rows. Prefer the value the
  // jobs query already returned (single source of truth, no clock skew
  // between two endpoints) and fall back to the career endpoint.
  const simNow =
    list.data?.simNow ?? career.data?.simDateTime ?? Date.now();

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Section heading */}
      <div className="flex items-end justify-between border-b border-ink-600 bg-ink-850 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Console · JBS
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text-high">
            Job Dispatch Board
          </h1>
          <p className="text-tiny text-muted">
            Live work order feed. New jobs appear automatically every 30
            seconds. Select a row to inspect.
          </p>
        </div>
      </div>

      <FuelShockBanner />

      <FleetStrip fleet={fleet} playerLocationIcao={playerLocationIcao} />

      {/* Active-job banner — renders only when the player is mid-flight on
          a contract. Keeps the board honest about what state they're in. */}
      <ActiveJobBanner activeJob={activeJob} onOpen={onOpenActiveJob} />

      {/* "What should I fly next?" — surfaced from the server's
          recommendedJobId pick. Pivots context when mid-flight to "after
          you arrive at X" so the rec is something the player can act on
          once they land. */}
      <RecommendedJobCard
        job={recommendedJob}
        simNow={simNow}
        playerLocationIcao={recommendationOriginIcao}
        captionMode={activeJob ? "after-arrival" : "from-here"}
        onOpen={(j) => setSelectedId(j.id)}
      />

      <JobFilters
        roleFilter={roleFilter}
        setRoleFilter={setRoleFilter}
        originScope={originScope}
        setOriginScope={setOriginScope}
        playerLocationIcao={playerLocationIcao}
        totalCount={allJobs.length}
        filteredCount={filteredJobs.length}
        onTickNow={() => tickNow.mutate()}
        isTicking={tickNow.isPending}
        lastTick={lastTick}
      />

      {/* Main pane — table only. The drawer is a sibling overlay below so it
          anchors to the JobBoard root (full vertical height) instead of just
          the post-strip region. paddingRight reserves space for the drawer
          so rows aren't hidden behind it. */}
      <div
        className="flex min-h-0 flex-1 transition-[padding] duration-200"
        style={{ paddingRight: drawerOpen ? 440 : 0 }}
      >
        <JobTable
          jobs={filteredJobs}
          sort={sort}
          onSortChange={setSort}
          selectedId={selectedId}
          onSelect={(j) =>
            setSelectedId((prev) => (prev === j.id ? null : j.id))
          }
          simNow={simNow}
          isLoading={list.isPending}
          recommendedJobId={recommendedJobId}
          originScope={originScope}
          onPauseRefetch={() => setInteractionPaused(true)}
          onResumeRefetch={() => setInteractionPaused(false)}
          onTickNow={() => tickNow.mutate()}
          isTicking={tickNow.isPending}
          onClearFilters={() => setOriginScope("all")}
        />
      </div>

      <JobDrawer
        jobId={selectedId}
        onClose={() => setSelectedId(null)}
        simNow={simNow}
        reachability={
          selectedId != null
            ? allJobs.find((j) => j.id === selectedId)?.reachability ?? null
            : null
        }
        playerLocationIcao={playerLocationIcao}
      />
    </div>
  );
}
