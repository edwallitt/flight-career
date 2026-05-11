import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc.js";
import { formatCash, formatSimDateTime } from "../lib/formatters.js";
import { ActiveJobPill } from "../sections/active/ActiveJobPill.js";

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M7 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 7 5.5z" />
    </svg>
  );
}

function StatBlock({
  label,
  value,
  sub,
  emphasis,
  onClick,
  disabledReason,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
  onClick?: () => void;
  disabledReason?: string;
}) {
  const interactive = onClick != null;
  const Wrapper = interactive ? "button" : "div";
  const wrapperProps = interactive
    ? {
        type: "button" as const,
        onClick: disabledReason ? undefined : onClick,
        title: disabledReason,
        "aria-disabled": disabledReason ? true : undefined,
        className: [
          "flex flex-col px-5 py-2 text-left transition-colors",
          disabledReason
            ? "cursor-not-allowed opacity-70"
            : "hover:bg-amber-glow/[0.05] hover:text-text-high",
        ].join(" "),
      }
    : { className: "flex flex-col px-5 py-2" };

  return (
    <Wrapper {...(wrapperProps as React.HTMLAttributes<HTMLElement>)}>
      <span className="label">{label}</span>
      <span
        className={[
          "mt-0.5 font-mono text-[15px] tabular-nums",
          emphasis ? "text-amber-glow" : "text-text-high",
        ].join(" ")}
      >
        {value}
      </span>
      {sub && (
        <span className="mt-0.5 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
          {sub}
        </span>
      )}
    </Wrapper>
  );
}

function VRule() {
  return <div className="self-stretch w-px bg-ink-600" />;
}

function MsfsChip() {
  const navigate = useNavigate();
  const status = trpc.simBridge.status.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click while open. Listener attaches only when open.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const data = status.data;
  if (!data?.enabled) return null;

  const bridgeOk = data.bridgeConnection === "connected";
  const simOk = data.simConnection === "connected";
  let label = "OFFLINE";
  let dotCls = "bg-muted-dim";
  let textCls = "text-muted-dim";
  if (bridgeOk && simOk) {
    label = "CONNECTED";
    dotCls = "bg-emerald-400 shadow-[0_0_5px_rgba(16,185,129,0.55)]";
    textCls = "text-emerald-300";
  } else if (bridgeOk) {
    label = "WAITING";
    dotCls = "bg-amber-glow shadow-[0_0_5px_rgba(212,165,116,0.55)]";
    textCls = "text-amber-glow";
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-sm border border-ink-600 bg-ink-750 px-2 py-1 font-mono text-[10px] uppercase tracking-callsign hover:border-amber-deep"
        title="MSFS integration status"
      >
        <span className={["h-1.5 w-1.5 rounded-full", dotCls].join(" ")} />
        <span className="text-muted">MSFS</span>
        <span className="text-muted-dim">·</span>
        <span className={textCls}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 border border-ink-600 bg-ink-800 p-3 shadow-xl">
          <div className="font-mono text-micro uppercase tracking-callsign text-muted-dim">
            MSFS integration
          </div>
          <div className="mt-2 space-y-1.5 font-mono text-tiny">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  bridgeOk
                    ? "bg-emerald-400"
                    : data.bridgeConnection === "connecting"
                      ? "bg-amber-warm"
                      : "bg-muted-dim",
                ].join(" ")}
              />
              <span className="text-muted">Bridge</span>
              <span className="ml-auto text-text">
                {bridgeOk ? "Connected" : data.bridgeConnection === "connecting" ? "Connecting" : "Offline"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  simOk
                    ? "bg-emerald-400"
                    : data.simConnection === "reconnecting"
                      ? "bg-amber-warm"
                      : "bg-muted-dim",
                ].join(" ")}
              />
              <span className="text-muted">MSFS</span>
              <span className="ml-auto text-text">
                {simOk
                  ? data.simVersion ?? "Connected"
                  : data.simConnection === "reconnecting"
                    ? "Reconnecting"
                    : "Not detected"}
              </span>
            </div>
            {data.isTracking && (
              <div className="mt-1 rounded-sm border border-amber-deep/40 bg-amber-glow/[0.06] px-2 py-1 text-amber-glow">
                Tracking flight #{String(data.trackedJobId ?? 0).padStart(5, "0")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/settings");
            }}
            className="mt-3 w-full rounded-sm border border-ink-600 bg-ink-750 px-2 py-1.5 font-mono text-[11px] uppercase tracking-callsign text-muted hover:border-amber-deep hover:text-amber-glow"
          >
            Open settings →
          </button>
        </div>
      )}
    </div>
  );
}

function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function Header({
  onOpenActiveJob,
  onOpenTravel,
}: {
  onOpenActiveJob: () => void;
  onOpenTravel: () => void;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const career = trpc.career.get.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const activeJob = trpc.lifecycle.getActiveJob.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const setPaused = trpc.career.setPaused.useMutation({
    onSuccess: () => utils.career.get.invalidate(),
  });

  const data = career.data;
  const activeJobBlock = activeJob.data != null;
  const isPaused = data?.isPaused ?? false;

  return (
    <header className="flex shrink-0 items-stretch border-b border-ink-600 bg-ink-800/60 backdrop-blur-sm">
      {/* Pilot block */}
      <div className="flex items-center gap-3 border-r border-ink-600 px-6 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-amber-deep bg-amber-glow/[0.06] font-mono text-sm font-medium text-amber-glow">
          {data?.pilotName?.charAt(0).toUpperCase() ?? "·"}
        </div>
        <div className="flex flex-col">
          <span className="label">Pilot</span>
          <span className="font-mono text-[13px] text-text-high">
            {data?.pilotName ?? "—"}
          </span>
        </div>
      </div>

      <StatBlock
        label="Cash on hand"
        emphasis
        value={data ? formatCash(data.cash) : "—"}
        sub="Operating capital"
      />
      <VRule />

      <StatBlock
        label="Position"
        value={
          <span className="icao text-text-high">
            {data?.currentLocationIcao ?? "—"}
          </span>
        }
        sub={data?.currentLocationName ?? ""}
        onClick={onOpenTravel}
        disabledReason={
          activeJobBlock
            ? "Cannot travel while a job is active"
            : undefined
        }
      />
      <VRule />

      <StatBlock
        label="Sim time · UTC"
        value={data ? formatSimDateTime(data.simDateTime) : "—"}
        sub={
          data
            ? `Started ${new Date(data.startedAt).toISOString().slice(0, 10)}`
            : ""
        }
      />

      <div className="flex-1" />

      {/* Active job pill — only renders when there's an active job. */}
      <div className="flex items-center px-3">
        <ActiveJobPill onOpen={onOpenActiveJob} />
      </div>

      {/* Right rail: status + pause + settings */}
      <div className="flex items-center gap-4 border-l border-ink-600 px-5">
        <MsfsChip />
        <div
          className={[
            "flex items-center gap-2 font-mono text-micro uppercase tracking-callsign",
            isPaused ? "text-urgency-urgent" : "text-muted-dim",
          ].join(" ")}
        >
          <span className="relative flex h-1.5 w-1.5">
            {isPaused ? (
              <span className="relative h-1.5 w-1.5 rounded-full bg-urgency-urgent" />
            ) : (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-glow/60" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-amber-glow" />
              </>
            )}
          </span>
          {isPaused ? "Paused" : "Live · trpc"}
        </div>
        <button
          type="button"
          onClick={() => setPaused.mutate({ paused: !isPaused })}
          disabled={setPaused.isPending || !data}
          aria-label={isPaused ? "Resume sim" : "Pause sim"}
          aria-pressed={isPaused}
          title={
            isPaused
              ? "Resume sim — time advances, jobs expire, fuel drifts"
              : "Pause sim — freeze time to plan a flight"
          }
          className={[
            "flex h-8 items-center gap-2 rounded-sm border px-3 font-mono text-[11px] uppercase tracking-callsign transition-colors disabled:opacity-40",
            isPaused
              ? "border-urgency-urgent bg-urgency-urgent/[0.08] text-urgency-urgent hover:bg-urgency-urgent/[0.16]"
              : "border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow",
          ].join(" ")}
        >
          {isPaused ? <PlayIcon /> : <PauseIcon />}
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600 bg-ink-750 text-muted hover:border-amber-deep hover:text-amber-glow"
          aria-label="Settings"
          onClick={() => navigate("/settings")}
        >
          <CogIcon />
        </button>
      </div>
    </header>
  );
}
