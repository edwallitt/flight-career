import { useEffect } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { trpc } from "../../trpc.js";
import { formatPay } from "../../lib/formatters.js";

type Snapshot = NonNullable<inferRouterOutputs<AppRouter>["career"]["snapshot"]>;
type Ratings = Snapshot["ratings"];

const CLASS_FULL: Record<string, string> = {
  MEP: "Multi Engine Piston",
  SET: "Single Engine Turbine",
  JET: "Jet",
};

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Exams resolve instantly: this modal is the spend confirmation for paying the
// fee and earning the rating on the spot.
export function ExamModal({
  cls,
  ratings,
  onClose,
}: {
  cls: "MEP" | "SET" | "JET";
  ratings: Ratings;
  onClose: () => void;
}) {
  useEscape(onClose);
  const utils = trpc.useUtils();
  const book = trpc.career.bookExam.useMutation();

  const card = ratings.find((r) => r.class === cls);
  const fee = card?.requirement?.examCostCents ?? 0;

  function onConfirm() {
    book.mutate(
      { class: cls },
      {
        onSuccess: (result) => {
          if (result.ok) {
            utils.career.snapshot.invalidate();
            utils.career.get.invalidate();
            onClose();
          }
        },
      },
    );
  }

  const errorMsg = (() => {
    if (book.error) return book.error.message;
    if (book.data && !book.data.ok) return book.data.error;
    return null;
  })();

  const pending = book.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 px-6 py-10">
      <div className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-sm border border-ink-600 bg-ink-850 shadow-2xl">
        <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
        <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
        <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
        <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

        <div className="border-b border-ink-600 bg-ink-800 px-6 pt-5 pb-4">
          <div className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
            Career · Take exam
          </div>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-high">
            {cls} <span className="text-muted">·</span>{" "}
            <span className="text-text">{CLASS_FULL[cls]}</span>
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          <p className="text-[13px] text-muted">
            You meet the requirements for the {cls} rating. Paying the exam fee
            earns the rating immediately — the check ride is resolved on the
            spot.
          </p>
          <div className="flex flex-col gap-2 rounded-sm border border-ink-600 bg-ink-800/40 p-4 font-mono text-[11px] tabular-nums text-muted">
            <div className="flex justify-between">
              <span>Exam fee</span>
              <span className="text-text-high">{formatPay(fee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Resolution</span>
              <span className="text-text-high">Rating earned now</span>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-sm border border-urgency-critical/40 bg-urgency-critical/[0.08] px-3 py-2 font-mono text-[11px] text-urgency-critical">
              {errorMsg}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-ink-600 bg-ink-750 px-4 py-2 font-mono text-[11px] uppercase tracking-callsign text-muted hover:text-text-high"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className={[
                "rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-callsign transition-colors",
                "border-amber-deep bg-amber-glow/[0.08] text-amber-glow hover:bg-amber-glow/[0.16]",
                pending ? "opacity-50" : "",
              ].join(" ")}
            >
              {pending ? "Working…" : "Pay fee · earn rating"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
