import { useMemo, useState } from "react";
import { trpc } from "../../trpc.js";
import { JobDrawer } from "./JobDrawer.js";
import { JobFilters } from "./JobFilters.js";
import { JobTable } from "./JobTable.js";
import type {
  ClassFilter,
  JobRow,
  RoleFilter,
  SortState,
} from "./types.js";

const CLASS_RANK: Record<string, number> = { SEP: 0, MEP: 1, SET: 2, JET: 3 };

export function JobBoard() {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [classFilter, setClassFilter] = useState<ClassFilter>("any");
  const [reachableOnly, setReachableOnly] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "pay", dir: "desc" });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const list = trpc.jobs.listWithReachability.useQuery(undefined, {
    refetchInterval: 10_000,
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
  const playerLocationIcao = list.data?.playerLocationIcao ?? "";

  const filteredJobs = useMemo(() => {
    return allJobs.filter((j) => {
      if (roleFilter !== "all" && j.role !== roleFilter) return false;
      if (
        classFilter !== "any" &&
        CLASS_RANK[j.requiredClass]! < CLASS_RANK[classFilter]!
      ) {
        return false;
      }
      if (reachableOnly && j.reachability.status === "unreachable") {
        return false;
      }
      return true;
    });
  }, [allJobs, roleFilter, classFilter, reachableOnly]);

  const simNow = career.data?.simDateTime ?? Date.now();
  const drawerOpen = selectedId != null;

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
                      u === "critical" && "bg-urgency-critical shadow-[0_0_6px_rgba(225,92,79,0.65)]",
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

      <JobFilters
        roleFilter={roleFilter}
        setRoleFilter={setRoleFilter}
        classFilter={classFilter}
        setClassFilter={setClassFilter}
        reachableOnly={reachableOnly}
        setReachableOnly={setReachableOnly}
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
          playerLocationIcao={playerLocationIcao}
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
