import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { trpc } from "../../trpc.js";
import { FitLegend } from "./FitLegend.js";
import { FleetStrip } from "./FleetStrip.js";
import { FuelShockBanner } from "./FuelShockBanner.js";
import { JobDrawer } from "./JobDrawer.js";
import { JobFilters } from "./JobFilters.js";
import { JobTable } from "./JobTable.js";
import type {
  ClassFilter,
  FleetReadout,
  JobRow,
  RoleFilter,
  SortState,
} from "./types.js";

const CLASS_RANK: Record<string, number> = { SEP: 0, MEP: 1, SET: 2, JET: 3 };

const EMPTY_FLEET: FleetReadout = {
  ownedHere: [],
  ownedElsewhere: 0,
  rentalsHere: [],
};

export function JobBoard() {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [classFilter, setClassFilter] = useState<ClassFilter>("any");
  // "Flyable now" replaces the old "reachable only" toggle — it filters to
  // jobs whose fit.status is ready or reposition, i.e. there's an aircraft
  // the player can actually dispatch right now that satisfies payload,
  // range, and capability. Default on; the player can drop it to see the
  // upgrade-target jobs that need a bigger aircraft.
  const [flyableOnly, setFlyableOnly] = useState(true);
  const [atMyLocationOnly, setAtMyLocationOnly] = useState(false);
  // Pay/hour is the column the player actually cares about: pay normalized
  // by positioning + flight time. Default descending so the best return on
  // the next leg of flying is right at the top.
  const [sort, setSort] = useState<SortState>({ key: "payHour", dir: "desc" });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Deep-link support: `?jobId=42` (used by the Atlas drawer's "View in Job
  // Board" button) selects that job on arrival and scrolls it into view. We
  // read-only on URL change — closing the drawer doesn't strip the param,
  // and selecting a different row doesn't write it back. That keeps deep
  // links idempotent and lets react-router stay in charge of history.
  const [searchParams] = useSearchParams();
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
  // group's row into view. Runs once per (selectedId, jobs-loaded) pair —
  // re-renders for refetches don't keep yanking the viewport.
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
  const fleet = list.data?.fleet ?? EMPTY_FLEET;

  const filteredJobs = useMemo(() => {
    return allJobs.filter((j) => {
      if (roleFilter === "ferry") {
        if (j.jobType !== "ferry") return false;
      } else if (roleFilter !== "all") {
        if (j.jobType === "ferry") return false;
        if (j.role !== roleFilter) return false;
      }
      if (
        classFilter !== "any" &&
        CLASS_RANK[j.requiredClass]! < CLASS_RANK[classFilter]!
      ) {
        return false;
      }
      // Flyable-now keeps ready + reposition. wont_fit + locked are hidden.
      if (
        flyableOnly &&
        j.fit.status !== "ready" &&
        j.fit.status !== "reposition"
      ) {
        return false;
      }
      if (atMyLocationOnly && j.originIcao !== playerLocationIcao) {
        return false;
      }
      return true;
    });
  }, [
    allJobs,
    roleFilter,
    classFilter,
    flyableOnly,
    atMyLocationOnly,
    playerLocationIcao,
  ]);

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

        {/* Right: tally chips */}
        <div className="flex items-center gap-3">
          {(["critical", "urgent", "standard", "flexible"] as const).map(
            (u) => {
              const count = allJobs.filter((j) => j.urgency === u).length;
              return (
                <div
                  key={u}
                  className="flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-800 px-3 py-1.5"
                >
                  <span
                    className={[
                      "h-1.5 w-1.5 rounded-full",
                      u === "critical" &&
                        "bg-urgency-critical shadow-[0_0_6px_rgba(225,92,79,0.65)]",
                      u === "urgent" && "bg-urgency-urgent",
                      u === "standard" && "bg-urgency-standard",
                      u === "flexible" && "bg-urgency-flexible",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                    {u.slice(0, 4)}
                  </span>
                  <span className="font-mono tabular-nums text-[12px] text-text-high">
                    {count.toString().padStart(2, "0")}
                  </span>
                </div>
              );
            },
          )}
        </div>
      </div>

      <FuelShockBanner />

      <FleetStrip fleet={fleet} playerLocationIcao={playerLocationIcao} />

      <FitLegend />

      <JobFilters
        roleFilter={roleFilter}
        setRoleFilter={setRoleFilter}
        classFilter={classFilter}
        setClassFilter={setClassFilter}
        flyableOnly={flyableOnly}
        setFlyableOnly={setFlyableOnly}
        atMyLocationOnly={atMyLocationOnly}
        setAtMyLocationOnly={setAtMyLocationOnly}
        playerLocationIcao={playerLocationIcao}
        totalCount={allJobs.length}
        filteredCount={filteredJobs.length}
        onTickNow={() => tickNow.mutate()}
        isTicking={tickNow.isPending}
        lastTick={lastTick}
      />

      {/* Main two-pane area */}
      <div
        className="relative flex min-h-0 flex-1 transition-[padding] duration-200"
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
          flyableOnly={flyableOnly}
          onPauseRefetch={() => setInteractionPaused(true)}
          onResumeRefetch={() => setInteractionPaused(false)}
          onTickNow={() => tickNow.mutate()}
          isTicking={tickNow.isPending}
          onClearFilters={() => setFlyableOnly(false)}
        />

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
    </div>
  );
}
