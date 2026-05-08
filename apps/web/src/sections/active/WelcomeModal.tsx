import { useEffect, useState } from "react";
import { trpc } from "../../trpc.js";
import { CornerTicks } from "../../components/CornerTicks.js";

const STORAGE_KEY = "flightcareer.welcomeSeen";

// First-run welcome. The seeded inheritance places a C152 with tail "C-GPOP"
// into the hangar; presence of that aircraft is the cheapest signal that this
// is a freshly-seeded career. Closing the modal flips a localStorage key so
// it doesn't reappear. If the player wipes the DB without clearing storage
// they won't see it again — acceptable for a once-per-career intro.
export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const owned = trpc.travel.listOwnedForTransfer.useQuery();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;

    const fleet = owned.data;
    if (!fleet) return;

    const hasInheritedC152 = fleet.some((a) => a.tailNumber === "C-GPOP");
    if (hasInheritedC152) setOpen(true);
  }, [owned.data]);

  const close = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="relative w-[560px] max-w-[92vw] overflow-hidden rounded-sm border border-amber-deep/60 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CornerTicks />

        <div className="border-b border-ink-600 px-7 pt-6 pb-4">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Welcome · WLC
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-text-high">
            Your grandfather's hangar
          </h2>
          <p className="mt-1 font-mono text-tiny text-muted-dim">
            CYHZ · Halifax Stanfield International
          </p>
        </div>

        <div className="space-y-4 px-7 py-6 text-[14px] leading-relaxed text-text">
          <p>
            The keys came in a manila envelope. The note was short:{" "}
            <em className="text-amber-warm">
              "She still flies. Don't let her sit."
            </em>
          </p>
          <p>
            Your grandfather flew freight up the coast for thirty years. He left
            you his Cessna 152 —{" "}
            <span className="font-mono tracking-callsign text-amber-glow">
              C-GPOP
            </span>{" "}
            — fuelled, recently inspected, hangared at Halifax. There's also{" "}
            <span className="font-mono text-amber-warm">$60,000</span> in the
            account he opened in your name when you started training.
          </p>
          <p>
            That's the start. The Job Dispatch Board fills with work every
            half-hour. Pick a route, brief the flight, fly it in MSFS, log the
            result. Build hours, build a name, build a fleet.
          </p>
          <p className="text-tiny text-muted">
            Tip: the small green dot on a job row means it departs from your
            current airport — no repositioning needed.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-ink-600 bg-ink-850/60 px-7 py-4">
          <button
            type="button"
            onClick={close}
            className="rounded-sm border border-amber-deep bg-amber-glow/[0.08] px-5 py-2 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm"
          >
            ▸ Pre-flight
          </button>
        </div>
      </div>
    </div>
  );
}
