import { trpc } from "../../trpc.js";
import { formatCash } from "../../lib/formatters.js";
import {
  ENGINE_TONE_CLASS,
  getEngineHealthTone,
} from "../../lib/engineHealth.js";

const CONDITION_TONE: Record<string, string> = {
  pristine: "text-emerald-300",
  excellent: "text-sky-300",
  good: "text-text-high",
  fair: "text-amber-glow",
  project: "text-urgency-urgent",
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

function EngineBar({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const pct = Math.round(clamped * 100);
  const color =
    clamped >= 0.85
      ? "bg-urgency-critical"
      : clamped >= 0.6
        ? "bg-amber-glow"
        : "bg-emerald-400";
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm border border-ink-600 bg-ink-850">
      <div className={`${color} h-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MarketDrawer({
  listingId,
  onClose,
  onPurchase,
}: {
  listingId: number | null;
  onClose: () => void;
  onPurchase: (listingId: number) => void;
}) {
  const open = listingId != null;
  const detail = trpc.marketplace.listingById.useQuery(
    { id: listingId ?? -1 },
    { enabled: listingId != null },
  );
  const listing = detail.data;

  const engineRatio =
    listing && listing.tboHours > 0
      ? listing.engineHoursSinceOverhaul / listing.tboHours
      : 0;
  const depreciationPct = listing
    ? Math.round((1 - listing.depreciationFactor) * 100)
    : 0;

  return (
    <aside
      className={[
        "absolute right-0 top-0 bottom-0 z-30 flex w-[440px] flex-col border-l border-ink-600 bg-ink-800 shadow-2xl",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      <span className="pointer-events-none absolute left-3 top-3 block h-2 w-2 border-l border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 top-3 block h-2 w-2 border-r border-t border-amber-deep/70" />
      <span className="pointer-events-none absolute left-3 bottom-3 block h-2 w-2 border-l border-b border-amber-deep/70" />
      <span className="pointer-events-none absolute right-3 bottom-3 block h-2 w-2 border-r border-b border-amber-deep/70" />

      <div className="flex items-start justify-between border-b border-ink-600 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.6)]" />
            Market · #{String(listingId ?? "").padStart(5, "0")}
          </div>
          <div className="font-display text-xl font-semibold tracking-tight text-text-high">
            {listing?.tailNumber ?? "—"}
          </div>
          {listing && (
            <div className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
              {listing.aircraftTypeManufacturer} {listing.aircraftTypeModel} ·{" "}
              <span className="text-amber-deep">{listing.aircraftClass}</span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {!listing ? (
          <div className="flex flex-1 items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
            {detail.isPending ? "loading…" : "no listing selected"}
          </div>
        ) : (
          <>
            {/* Location */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="label">Location</span>
                  <span className="icao text-[22px] font-medium text-text-high">
                    {listing.locationIcao}
                  </span>
                  <span className="mt-0.5 text-tiny text-muted-dim">
                    {listing.locationName}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="label">Distance</span>
                  <span className="font-mono text-[15px] tabular-nums text-text-high">
                    {listing.distanceFromPlayerNm == null ? (
                      "—"
                    ) : listing.distanceFromPlayerNm === 0 ? (
                      <span className="text-emerald-300">here</span>
                    ) : (
                      <>
                        {listing.distanceFromPlayerNm.toLocaleString()}{" "}
                        <span className="text-muted-dim">nm</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Specs */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-sm border border-ink-600 bg-ink-750 p-4">
              <Field label="Airframe hours">
                <span className="tabular-nums">
                  {Math.round(listing.airframeHours).toLocaleString()}
                </span>
              </Field>
              <Field label="Condition" align="right">
                <span
                  className={[
                    "font-mono text-[12px] uppercase tracking-callsign",
                    CONDITION_TONE[listing.conditionGrade] ?? "text-muted",
                  ].join(" ")}
                >
                  {listing.conditionGrade}
                </span>
              </Field>

              <div className="col-span-2">
                <span className="label">Engine</span>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className="font-mono text-[13px] tabular-nums text-text-high">
                    <span
                      className={
                        ENGINE_TONE_CLASS[
                          getEngineHealthTone(
                            listing.engineHoursSinceOverhaul,
                            listing.tboHours,
                          )
                        ]
                      }
                    >
                      {Math.round(listing.engineHoursSinceOverhaul).toLocaleString()}
                    </span>{" "}
                    <span className="text-muted-dim">
                      / {listing.tboHours.toLocaleString()}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-callsign text-muted-dim">
                    {Math.round(listing.engineRemainingHours).toLocaleString()} hrs
                    remaining
                  </span>
                </div>
                <EngineBar ratio={engineRatio} />
              </div>

              <Field label="Last 100hr">
                <span className="tabular-nums">
                  {Math.round(listing.hoursSince100hr).toLocaleString()} hrs ago
                </span>
              </Field>
              <Field label="Last annual" align="right">
                <span className="tabular-nums">
                  {Math.round(listing.hoursSinceAnnual).toLocaleString()} days
                  ago
                </span>
              </Field>

              <Field label="Fuel capacity">
                <span className="tabular-nums">
                  {Math.round(listing.fuelCapacityGal).toLocaleString()} gal
                </span>
              </Field>
              <Field label="Fuel type" align="right">
                <span className="font-mono text-[12px] uppercase tracking-callsign text-muted">
                  {listing.fuelType === "jet-a" ? "Jet A" : "Avgas"}
                </span>
              </Field>
            </div>

            {listing.descriptionShort && (
              <div className="border-l-2 border-amber-deep/70 pl-3">
                <p className="text-[13px] italic leading-relaxed text-muted">
                  "{listing.descriptionShort}"
                </p>
              </div>
            )}

            {/* Price */}
            <div className="rounded-sm border border-ink-600 bg-ink-750 p-4">
              <div className="flex items-end justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="label">Asking price</span>
                  <span className="font-mono text-[26px] tabular-nums text-amber-warm">
                    {formatCash(listing.askingPriceCents)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="label">New price</span>
                  <span className="font-mono text-[13px] tabular-nums text-muted-dim line-through">
                    {formatCash(listing.basePurchasePriceCents)}
                  </span>
                  {depreciationPct > 0 && (
                    <span className="font-mono text-[11px] uppercase tracking-callsign text-emerald-300">
                      −{depreciationPct}% from new
                    </span>
                  )}
                  {depreciationPct < 0 && (
                    <span className="font-mono text-[11px] uppercase tracking-callsign text-amber-glow">
                      +{Math.abs(depreciationPct)}% over new
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Travel hint */}
            <div
              className={[
                "rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-callsign",
                listing.distanceFromPlayerNm === 0
                  ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300"
                  : "border-amber-deep/60 bg-amber-glow/[0.06] text-amber-glow",
              ].join(" ")}
            >
              {listing.distanceFromPlayerNm === 0 ? (
                "✓ At your current location"
              ) : (
                <>
                  {listing.distanceFromPlayerNm?.toLocaleString() ?? "—"}nm from
                  your current location. Use Travel to reposition.
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2 border-t border-ink-600 bg-ink-800 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-sm border border-ink-600 bg-ink-750 py-3 font-mono text-[12px] uppercase tracking-callsign text-muted hover:text-text-high"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!listing}
          onClick={() => listing && onPurchase(listing.id)}
          className="group relative flex-1 overflow-hidden rounded-sm border border-amber-deep bg-amber-glow/[0.08] py-3 font-mono text-[12px] uppercase tracking-callsign text-amber-glow transition-colors hover:bg-amber-glow/[0.16] hover:text-amber-warm disabled:opacity-40"
        >
          Purchase aircraft
        </button>
      </div>
    </aside>
  );
}
