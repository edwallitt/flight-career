import { useState } from "react";
import { trpc } from "../../trpc.js";
import { CareerHeader } from "./CareerHeader.js";
import { ExamModal } from "./ExamModal.js";
import { Milestones } from "./Milestones.js";
import { RatingsSection } from "./RatingsSection.js";
import { ReputationSection } from "./ReputationSection.js";

// Exams resolve instantly on payment, so the only modal is the spend
// confirmation for taking one. No pending/cancel state exists anymore.
type ExamModalState = { class: "MEP" | "SET" | "JET" } | null;

export function Career() {
  const snapshotQuery = trpc.career.snapshot.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const [modal, setModal] = useState<ExamModalState>(null);

  const data = snapshotQuery.data ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CareerHeader snapshot={data} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Subtle radial vignette to give the dark expanse depth without
            stealing focus from the data. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212,165,116,0.06), transparent 70%), radial-gradient(ellipse 60% 60% at 100% 100%, rgba(212,165,116,0.03), transparent 70%)",
          }}
        />

        <div className="relative px-6 py-7">
          {snapshotQuery.isPending || !data ? (
            <div className="flex h-full min-h-[300px] items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-glow" />
                Loading dossier…
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-12">
              <RatingsSection
                ratings={data.ratings}
                onBook={(cls) => setModal({ class: cls })}
              />
              <ReputationSection
                byRole={data.reputation.byRole}
                byClient={data.reputation.byClient}
                simNow={data.simNow}
              />
              <Milestones data={data.milestones} />

              {/* Footer plate */}
              <div className="flex items-center justify-between border-t border-ink-700/60 pt-3 font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
                <span>End of dossier</span>
                <span>FlightCareer · Civil Aviation Registry</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <ExamModal
          cls={modal.class}
          onClose={() => setModal(null)}
          ratings={data?.ratings ?? []}
        />
      )}
    </div>
  );
}
