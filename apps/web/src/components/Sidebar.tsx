import { NavLink } from "react-router-dom";

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
    enabled: false,
    icon: (
      <ItemIcon d="M3 21V10l9-6 9 6v11M9 21v-7h6v7" />
    ),
  },
  {
    to: "/career",
    code: "CRW",
    label: "Career",
    enabled: false,
    icon: (
      <ItemIcon d="M5 7h14v12H5zM9 7V5a3 3 0 0 1 6 0v2" />
    ),
  },
  {
    to: "/logbook",
    code: "LOG",
    label: "Logbook",
    enabled: false,
    icon: (
      <ItemIcon d="M5 4h11l3 3v13H5zM9 9h7M9 13h7M9 17h4" />
    ),
  },
  {
    to: "/map",
    code: "MAP",
    label: "Atlas",
    enabled: false,
    icon: (
      <ItemIcon d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />
    ),
  },
];

export function Sidebar() {
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
