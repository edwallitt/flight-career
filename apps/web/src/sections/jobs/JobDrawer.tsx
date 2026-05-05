import { useEffect, useState } from "react";
import { trpc } from "../../trpc.js";
import {
  formatPay,
  formatPayloadType,
  formatRelativeFromNow,
  formatSimDateTime,
  ROLE_LABEL,
} from "../../lib/formatters.js";
import { AircraftCandidatesPanel } from "../active/AircraftCandidatesPanel.js";
import type { AircraftSelection } from "../active/types.js";

const URGENCY_TONE: Record<string, string> = {
  critical: "border-urgency-critical/70 text-urgency-critical bg-urgency-critical/[0.08]",
  urgent: "border-urgency-urgent/70 text-urgency-urgent bg-urgency-urgent/[0.07]",
  standard: "border-ink-500 text-muted bg-ink-700",
  flexible: "border-ink-500 text-muted-dim bg-ink-700",
};

const WEATHER_LABEL: Record<string, string> = {
  none: "All-weather · IFR/IMC",
  mild: "Mild — patient comfort",
  strict: "VFR · CAVOK preferred",
};

const WEATHER_TONE: Record<string, string> = {
  none: "text-emerald-300",
  mild: "text-sky-300",
  strict: "text-amber-glow",
};

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

function Field({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className={[
        "flex flex-col gap-0.5",
        align === "right" && "items-end text-right",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="label">{label}</span>
      <span className="font-mono text-[13px] text-text-high">{children}</span>
    </div>
  );
}

export function JobDrawer({
  jobId,
  onClose,
  simNow,
}: {
  jobId: number | null;
  onClose: () => void;
  simNow: number;
}) {
  const detail = trpc.jobs.getById.useQuery(
    { id: jobId ?? -1 },
    { enabled: jobId != null },
  );
  const activeJob = trpc.lifecycle.getActiveJob.useQuery();
  const utils = trpc.useUtils();
  const acceptMutation = trpc.lifecycle.accept.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        utils.jobs.list.invalidate();
        utils.lifecycle.getActiveJob.invalidate();
        utils.career.get.invalidate();
        onClose();
      }
    },
  });

  const [selection, setSelection] = useState<AircraftSelection | null>(null);

  // Reset selection whenever the drawer points to a different job.
  // `acceptMutation.reset` is referentially stable from useMutation, so
  // including it in deps doesn't trigger re-runs but satisfies exhaustive-deps.
  const resetMutation = acceptMutation.reset;
  useEffect(() => {
    setSelection(null);
    resetMutation();
  }, [jobId, resetMutation]);

  const open = jobId != null;
  const job = detail.data;
  const hasActiveJob = activeJob.data != null;
  const errorMsg =
    acceptMutation.data && !acceptMutation.data.ok
      ? acceptMutation.data.error
      : acceptMutation.error
        ? acceptMutation.error.message
        : null;

  return (
    <aside
      className={[
        "absolute right-0 top-0 bottom-0 z-30 flex w-[440px] flex-col border-l border-ink-600 bg-ink-800 shadow-2xl",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      {/* Top corner ticks for tactical feel */}
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

      {/* Header */}
      <div className="flex items-start justify-between border-b border-ink-600 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Job · #{String(jobId ?? "").padStart(5, "0")}
          </div>
          <div className="font-display text-xl font-semibold tracking-tight text-text-high">
            {job?.clientName ?? (job ? "Open Market" : "—")}
          </div>
          {job && (
            <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
              {ROLE_LABEL[job.role] ?? job.role}
            </div>
          )}
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

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {!job ? (
          <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
            {detail.isPending ? "loading…" : "no job selected"}
          </div>
        ) : (
          <>
            {/* Route block */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="label">From</span>
                  <span className="icao text-[22px] font-medium text-text-high">
                    {job.originIcao}
                  </span>
                  <span className="mt-0.5 text-tiny text-muted-dim">
                    {job.originName ?? ""}
                  </span>
                </div>

                <div className="mx-3 flex flex-1 items-center justify-center">
                  <div className="flex flex-1 flex-col items-center">
                    <svg
                      width="100%"
                      height="14"
                      viewBox="0 0 200 14"
                      preserveAspectRatio="none"
                      className="text-amber-deep"
                      aria-hidden
                    >
                      <line
                        x1="2"
                        y1="7"
                        x2="198"
                        y2="7"
                        stroke="currentColor"
                        strokeDasharray="3 4"
                      />
                      <circle cx="2" cy="7" r="2.5" fill="currentColor" />
                      <circle cx="198" cy="7" r="2.5" fill="currentColor" />
                    </svg>
                    <span className="mt-1 font-mono text-[10px] uppercase tracking-callsign text-muted-dim">
                      single leg
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span className="label">To</span>
                  <span className="icao text-[22px] font-medium text-text-high">
                    {job.destinationIcao}
                  </span>
                  <span className="mt-0.5 text-tiny text-muted-dim text-right">
                    {job.destinationName ?? ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="border-l-2 border-amber-deep/70 pl-3">
              <p className="text-[13px] leading-relaxed text-text">
                {job.description}
              </p>
              {job.clientDescription && (
                <p className="mt-3 text-tiny italic text-muted">
                  {job.clientDescription}
                </p>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-sm border border-ink-600 bg-ink-750 p-4">
              <Field label="Min class">
                <span className="text-amber-glow">{job.requiredClass}</span>
              </Field>
              <Field label="Pay" align="right">
                <span className="text-[16px] text-amber-warm">
                  {formatPay(job.pay)}
                </span>
              </Field>

              <Field label="Payload">
                {job.payloadLbs.toLocaleString()} lb ·{" "}
                <span className="text-muted">
                  {formatPayloadType(job.payloadType)}
                </span>
              </Field>
              <Field label="Pax" align="right">
                {job.paxCount ?? "—"}
              </Field>

              <Field label="Urgency">
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] uppercase tracking-callsign",
                    URGENCY_TONE[job.urgency] ?? "",
                  ].join(" ")}
                >
                  {job.urgency}
                </span>
              </Field>
              <Field label="Weather" align="right">
                <span
                  className={[
                    "text-[12px]",
                    WEATHER_TONE[job.weatherSensitivity] ?? "",
                  ].join(" ")}
                >
                  {WEATHER_LABEL[job.weatherSensitivity] ?? job.weatherSensitivity}
                </span>
              </Field>

              {job.requiredCapabilities.length > 0 && (
                <Field label="Capabilities">
                  <div className="flex flex-wrap gap-1">
                    {job.requiredCapabilities.map((c) => (
                      <span
                        key={c}
                        className="rounded-sm border border-amber-deep/70 bg-amber-glow/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-callsign text-amber-glow"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
            </div>

            {/* Window */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center gap-2">
                <span className="label">Schedule window</span>
                <span className="h-px flex-1 bg-ink-600" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Earliest">
                  {job.earliestDeparture
                    ? formatSimDateTime(job.earliestDeparture)
                    : "Anytime"}
                </Field>
                <Field label="Latest" align="right">
                  {job.latestDeparture
                    ? formatSimDateTime(job.latestDeparture)
                    : "Anytime"}
                </Field>
                <Field label="Generated">
                  {formatRelativeFromNow(job.generatedAt, simNow)} ago
                </Field>
                <Field label="Expires" align="right">
                  <span
                    className={
                      job.expiresAt - simNow < 60 * 60 * 1000
                        ? "text-urgency-critical"
                        : ""
                    }
                  >
                    in {formatRelativeFromNow(job.expiresAt, simNow)}
                  </span>
                </Field>
              </div>
            </div>

            {/* Aircraft selection */}
            <AircraftCandidatesPanel
              jobId={job.id}
              selection={selection}
              onSelectionChange={setSelection}
              hasActiveJob={hasActiveJob}
            />
          </>
        )}
      </div>

      {/* Footer with action */}
      <div className="border-t border-ink-600 bg-ink-800 px-6 py-4">
        <button
          type="button"
          disabled={
            !job || !selection || hasActiveJob || acceptMutation.isPending
          }
          onClick={() => {
            if (!job || !selection) return;
            const payload =
              selection.source === "owned"
                ? {
                    jobId: job.id,
                    aircraftSource: "owned" as const,
                    ownedAircraftId: selection.ownedAircraftId,
                  }
                : {
                    jobId: job.id,
                    aircraftSource: "rental" as const,
                    rentalAircraftTypeId: selection.rentalAircraftTypeId,
                  };
            acceptMutation.mutate(payload);
          }}
          className="group relative w-full overflow-hidden rounded-sm border border-amber-deep bg-amber-glow/[0.08] py-3 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:opacity-40"
        >
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-amber-deep">
            ▸
          </span>
          {acceptMutation.isPending ? "Accepting…" : "Accept job"}
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-amber-deep">
            ▸
          </span>
        </button>
        <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
          {errorMsg ? (
            <span className="text-urgency-critical">{errorMsg}</span>
          ) : hasActiveJob ? (
            "Active job in progress — open it from the header"
          ) : !selection ? (
            "Select an eligible aircraft to continue"
          ) : (
            "Commits the job · aircraft locked to this flight"
          )}
        </div>
      </div>
    </aside>
  );
}
