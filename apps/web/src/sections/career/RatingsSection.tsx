import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";
import { trpc } from "../../trpc.js";
import { formatPay } from "../../lib/formatters.js";
import { SectionHeader } from "./SectionHeader.js";

type AircraftClass = "SEP" | "MEP" | "SET" | "JET";
type Snapshot = NonNullable<inferRouterOutputs<AppRouter>["career"]["snapshot"]>;
type RatingCard = Snapshot["ratings"][number];

const CLASS_LABEL: Record<AircraftClass, string> = {
  SEP: "Single Engine Piston",
  MEP: "Multi Engine Piston",
  SET: "Single Engine Turbine",
  JET: "Jet",
};

const CLASS_INDEX: Record<AircraftClass, string> = {
  SEP: "I",
  MEP: "II",
  SET: "III",
  JET: "IV",
};

function formatEarnedDate(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${day}`;
}

// Card shell — corner registration ticks + variant-driven border tone.
function CardShell({
  variant,
  children,
}: {
  variant: "earned" | "eligible" | "locked" | "exam";
  children: React.ReactNode;
}) {
  const tone = {
    earned: "border-emerald-500/30 bg-ink-800/60",
    eligible:
      "border-amber-deep/70 bg-amber-glow/[0.05] shadow-[inset_0_0_0_1px_rgba(212,165,116,0.10)]",
    locked: "border-ink-600 bg-ink-800/30",
    exam: "border-amber-deep/70 bg-amber-glow/[0.04]",
  }[variant];

  const tickTone = {
    earned: "border-emerald-500/40",
    eligible: "border-amber-glow",
    locked: "border-ink-500",
    exam: "border-amber-glow",
  }[variant];

  return (
    <div
      className={[
        "relative flex h-full flex-col rounded-sm border p-5",
        tone,
      ].join(" ")}
    >
      {/* Corner registration ticks */}
      <span
        className={["pointer-events-none absolute left-0 top-0 h-2.5 w-2.5 border-l border-t", tickTone].join(" ")}
      />
      <span
        className={["pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r border-t", tickTone].join(" ")}
      />
      <span
        className={["pointer-events-none absolute left-0 bottom-0 h-2.5 w-2.5 border-l border-b", tickTone].join(" ")}
      />
      <span
        className={["pointer-events-none absolute right-0 bottom-0 h-2.5 w-2.5 border-r border-b", tickTone].join(" ")}
      />
      {children}
    </div>
  );
}

function ClassMark({
  cls,
  variant,
}: {
  cls: AircraftClass;
  variant: "earned" | "eligible" | "locked" | "exam";
}) {
  const tone = {
    earned: "text-text-high",
    eligible: "text-amber-warm",
    locked: "text-muted-dim",
    exam: "text-amber-warm",
  }[variant];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span
          className={[
            "font-display text-[34px] font-semibold leading-none tracking-tight",
            tone,
          ].join(" ")}
        >
          {cls}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
          {CLASS_INDEX[cls]}
        </span>
      </div>
      <span className="truncate font-mono text-[10px] uppercase tracking-wide2 text-muted">
        {CLASS_LABEL[cls]}
      </span>
    </div>
  );
}

function StatusSeal({
  variant,
  label,
}: {
  variant: "earned" | "eligible" | "locked" | "exam";
  label: string;
}) {
  const tone = {
    earned:
      "border-emerald-500/50 bg-emerald-500/[0.10] text-emerald-300",
    eligible:
      "border-amber-deep bg-amber-glow/[0.12] text-amber-glow",
    locked:
      "border-ink-500 bg-ink-750 text-muted-dim",
    exam: "border-amber-deep bg-amber-glow/[0.14] text-amber-glow",
  }[variant];
  return (
    <span
      className={[
        "shrink-0 whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[9px] uppercase tracking-callsign",
        tone,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

// 0..1 fill, with tick marks beneath.
function GatedBar({
  current,
  required,
  warm = false,
}: {
  current: number;
  required: number;
  warm?: boolean;
}) {
  const pct = Math.min(1, Math.max(0, current / required));
  const complete = current >= required;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="h-[3px] w-full overflow-hidden rounded-sm bg-ink-700">
        <div
          className={[
            "h-full transition-[width] duration-500",
            complete
              ? "bg-emerald-400/80"
              : warm
                ? "bg-amber-glow/80"
                : "bg-amber-glow/60",
          ].join(" ")}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="flex h-1 w-full justify-between">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={[
              "w-px",
              complete ? "bg-emerald-500/40" : "bg-ink-500",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

// Deterministic credential serial from class + issue date — looks plausible
// without storing anything new server-side.
function credentialSerial(cls: AircraftClass, earnedAt: number | null): string {
  if (!earnedAt) return `FC-${cls}-——————`;
  const d = new Date(earnedAt);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const doy = Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );
  // Hash-ish suffix from earnedAt so two SEPs issued the same day differ.
  const suffix = ((earnedAt / 1000) | 0).toString(16).slice(-4).toUpperCase();
  return `FC-${cls}-${yy}${String(doy).padStart(3, "0")}-${suffix}`;
}

// Rating earned — credential plate. Stamped feel.
function EarnedCard({ card }: { card: RatingCard }) {
  const cls = card.class as AircraftClass;
  const serial = credentialSerial(cls, card.earnedAt);
  return (
    <CardShell variant="earned">
      <div className="flex items-start justify-between gap-2">
        <ClassMark cls={cls} variant="earned" />
        <StatusSeal variant="earned" label="Certified" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-ink-700/60 pt-4 font-mono text-[11px] tabular-nums">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-callsign text-muted-faint">
            Issued
          </span>
          <span className="text-text-high">
            {card.earnedAt ? formatEarnedDate(card.earnedAt) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-callsign text-muted-faint">
            Hours · class
          </span>
          <span className="text-text-high">
            {card.hoursInClass.toFixed(1)} hrs
          </span>
        </div>
      </div>

      {/* Credential serial — fills the middle and adds dossier feel */}
      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        <div
          className="relative rounded-sm border border-ink-700/60 bg-ink-900/40 px-3 py-2.5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(212,165,116,0.04) 0px, rgba(212,165,116,0.04) 1px, transparent 1px, transparent 8px)",
          }}
        >
          <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
            <span>Cert. serial</span>
            <span className="text-amber-deep/70">verified</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] tabular-nums text-text-high">
            {serial}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-ink-700/40 pt-3 font-mono text-[9px] uppercase tracking-callsign text-muted-faint">
        <span>Civil Aviation Registry</span>
        <span className="text-emerald-400/70">✓ Active</span>
      </div>
    </CardShell>
  );
}

function ReqLine({
  label,
  current,
  required,
  warm = false,
}: {
  label: string;
  current: number;
  required: number;
  warm?: boolean;
}) {
  const met = current >= required;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between font-mono text-[10px] tabular-nums">
        <span className="uppercase tracking-callsign text-muted-faint">
          {label}
        </span>
        <span className={met ? "text-emerald-300" : "text-text-high"}>
          {current.toFixed(1)} / {required}
          {met ? " ✓" : ""}
        </span>
      </div>
      <GatedBar current={current} required={required} warm={warm} />
    </div>
  );
}

// Rating not yet earned — eligible or locked.
function ProgressCard({
  card,
  cash,
  onBook,
}: {
  card: RatingCard;
  cash: number;
  onBook: (cls: "MEP" | "SET" | "JET") => void;
}) {
  const cls = card.class as AircraftClass;
  const req = card.requirement!;
  const eligible = card.eligibility?.eligible ?? false;
  const variant: "eligible" | "locked" = eligible ? "eligible" : "locked";

  const totalReason = card.eligibility?.reasons.find(
    (r) => r.requirement === "hour_gate",
  );
  const classReason = card.eligibility?.reasons.find(
    (r) => r.requirement === "class_specific",
  );
  const totalProgress = totalReason?.progress ?? {
    current: card.totalHours,
    required: req.hourGate,
  };
  const classGate = req.classSpecificGate;
  const classProgress = classGate
    ? classReason?.progress ?? { current: classGate.hours, required: classGate.hours }
    : null;

  const canAfford = cash >= req.examCostCents;
  const canBook = eligible && canAfford;

  return (
    <CardShell variant={variant}>
      <div className="flex items-start justify-between gap-2">
        <ClassMark cls={cls} variant={variant} />
        <StatusSeal
          variant={variant}
          label={eligible ? "Cleared" : "In training"}
        />
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-ink-700/60 pt-4">
        <ReqLine
          label="Total time"
          current={totalProgress.current}
          required={req.hourGate}
          warm={eligible}
        />
        {classGate && classProgress && (
          <ReqLine
            label={`${classGate.inClass} time`}
            current={classProgress.current}
            required={classGate.hours}
            warm={eligible}
          />
        )}
      </div>

      <div
        className="mt-4 grid grid-cols-2 gap-3 rounded-sm border border-ink-700/60 px-3 py-2.5 font-mono text-[10px] tabular-nums"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(212,165,116,0.04) 0px, rgba(212,165,116,0.04) 1px, transparent 1px, transparent 8px)",
        }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-callsign text-muted-faint">
            Exam fee
          </span>
          <span
            className={canAfford ? "text-text-high" : "text-urgency-critical"}
          >
            {formatPay(req.examCostCents)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] uppercase tracking-callsign text-muted-faint">
            Resolution
          </span>
          <span className="text-text-high">Instant</span>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          type="button"
          disabled={!canBook}
          onClick={() => onBook(cls as "MEP" | "SET" | "JET")}
          className={[
            "group relative w-full overflow-hidden rounded-sm border px-3 py-2.5 font-mono text-[11px] uppercase tracking-callsign transition-all",
            canBook
              ? "border-amber-deep bg-amber-glow/[0.10] text-amber-glow hover:bg-amber-glow/[0.18] hover:shadow-[0_0_18px_-4px_rgba(212,165,116,0.45)]"
              : "cursor-not-allowed border-ink-600 bg-ink-750/70 text-muted-faint",
          ].join(" ")}
        >
          {canBook && (
            <span className="absolute inset-y-0 left-0 w-px bg-amber-glow" />
          )}
          {!eligible
            ? "Locked · requirements pending"
            : !canAfford
              ? "Funds short · cannot take"
              : "Take exam ▸"}
        </button>
      </div>
    </CardShell>
  );
}

function SepLockedCard() {
  // SEP is the starting rating — should always be earned. This is just a
  // defensive empty-state in case it isn't.
  return (
    <CardShell variant="locked">
      <div className="flex items-start justify-between">
        <ClassMark cls="SEP" variant="locked" />
        <StatusSeal variant="locked" label="Pending" />
      </div>
    </CardShell>
  );
}

export function RatingsSection({
  ratings,
  onBook,
}: {
  ratings: Snapshot["ratings"];
  onBook: (cls: "MEP" | "SET" | "JET") => void;
}) {
  const careerQuery = trpc.career.get.useQuery();
  const cash = careerQuery.data?.cash ?? 0;

  const earnedCount = ratings.filter((r) => r.earned).length;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        index="01"
        code="RTG"
        label="Certifications"
        title="Ratings"
        hint={`${earnedCount} / ${ratings.length} earned`}
      />
      <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ratings.map((card) => {
          if (card.earned) {
            return <EarnedCard key={card.class} card={card} />;
          }
          if (card.class === "SEP" || !card.requirement) {
            return <SepLockedCard key={card.class} />;
          }
          return (
            <ProgressCard
              key={card.class}
              card={card}
              cash={cash}
              onBook={onBook}
            />
          );
        })}
      </div>
    </section>
  );
}
