import { NavLink } from "react-router-dom";
import { trpc } from "../trpc.js";

interface NavItem {
  to: string;
  code: string; // 3-letter callsign-style code
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
}

const ItemIcon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const NAV: NavItem[] = [
  {
    to: "/jobs",
    code: "JBS",
    label: "Job Board",
    enabled: true,
    icon: (
      <ItemIcon d="M3 7h18M3 12h18M3 17h12" />
    ),
  },
  {
    to: "/hangar",
    code: "HGR",
    label: "Hangar",
    enabled: true,
    icon: (
      <ItemIcon d="M3 21V10l9-6 9 6v11M9 21v-7h6v7" />
    ),
  },
  {
    to: "/market",
    code: "MKT",
    label: "Market",
    enabled: true,
    icon: (
      <ItemIcon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    ),
  },
  {
    to: "/career",
    code: "CRW",
    label: "Career",
    enabled: true,
    icon: (
      <ItemIcon d="M5 7h14v12H5zM9 7V5a3 3 0 0 1 6 0v2" />
    ),
  },
  {
    to: "/logbook",
    code: "LOG",
    label: "Logbook",
    enabled: true,
    icon: (
      <ItemIcon d="M5 4h11l3 3v13H5zM9 9h7M9 13h7M9 17h4" />
    ),
  },
  {
    to: "/map",
    code: "MAP",
    label: "Atlas",
    enabled: true,
    icon: (
      <ItemIcon d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />
    ),
  },
  {
    to: "/settings",
    code: "CFG",
    label: "Settings",
    enabled: true,
    icon: (
      <ItemIcon d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    ),
  },
];

export function Sidebar() {
  const fleetQuery = trpc.hangar.fleet.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const headlineQuery = trpc.logbook.headline.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const careerSnapshotQuery = trpc.career.snapshot.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const fleetCount = fleetQuery.data?.length ?? 0;
  const flightCount = headlineQuery.data?.totalFlights ?? 0;
  const hasPendingExam =
    careerSnapshotQuery.data?.ratings.some((r) => r.pendingExam != null) ??
    false;
  const badgeByCode: Record<string, string | null> = {
    HGR: fleetCount > 0 ? String(fleetCount) : null,
    LOG: flightCount > 0 ? String(flightCount) : null,
  };
  const dotByCode: Record<string, boolean> = {
    CRW: hasPendingExam,
  };
  return (
    <aside className="flex w-[212px] shrink-0 flex-col border-r border-ink-600 bg-ink-800">
      {/* Wordmark block */}
      <div className="px-5 pt-6 pb-7">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[1.35rem] font-semibold leading-none tracking-tight text-text-high">
            Flight
          </span>
          <span className="font-display text-[1.35rem] font-semibold leading-none tracking-tight text-amber-glow">
            Career
          </span>
        </div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          v0 · maritime ops
        </div>
      </div>

      {/* Section: NAV */}
      <div className="px-5 pb-2">
        <div className="flex items-center gap-2">
          <span className="label">Console</span>
          <span className="h-px flex-1 bg-ink-600" />
        </div>
      </div>

      <nav className="flex-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-disabled={!item.enabled}
            className={({ isActive }) =>
              [
                "group relative flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm transition-colors",
                !item.enabled
                  ? "cursor-not-allowed text-muted-faint"
                  : isActive
                  ? "text-text-high"
                  : "text-muted hover:text-text-high",
              ].join(" ")
            }
            onClick={(e) => {
              if (!item.enabled) {
                e.preventDefault();
              }
            }}
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm transition-all",
                    isActive && item.enabled
                      ? "bg-amber-glow"
                      : "bg-transparent",
                  ].join(" ")}
                />
                <span
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded-sm border transition-colors",
                    isActive && item.enabled
                      ? "border-amber-deep bg-amber-glow/[0.06] text-amber-glow"
                      : "border-ink-600 bg-ink-750 text-muted group-hover:text-text-high",
                  ].join(" ")}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {dotByCode[item.code] && (
                  <span
                    title="Pending exam"
                    className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_4px_rgba(212,165,116,0.6)]"
                  />
                )}
                {badgeByCode[item.code] && (
                  <span
                    className={[
                      "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                      isActive && item.enabled
                        ? "border-amber-deep/60 bg-amber-glow/[0.10] text-amber-glow"
                        : "border-ink-600 bg-ink-750 text-muted",
                    ].join(" ")}
                  >
                    {badgeByCode[item.code]}
                  </span>
                )}
                <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                  {item.code}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: status block */}
      <div className="border-t border-ink-600 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="font-mono text-micro uppercase tracking-callsign text-muted">
            Sim · running
          </span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-faint">
          Tick rate · 30s
        </div>
      </div>
    </aside>
  );
}
