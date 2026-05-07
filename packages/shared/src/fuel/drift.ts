// Fuel-price drift logic. Pure functions — no I/O, no Date.now, no randomness
// outside the injected rng. Server pulls these into processFuelDriftTick.
//
// Two ideas in play:
//   * computeNextPrice — per-(airport, fuel_type) random walk + mean reversion,
//     bounded, with an optional shock multiplier as the final scalar.
//   * maybeSpawnShock — low-probability narrative shock generator. Returns a
//     ShockEvent or null. Server persists a row to fuel_shocks and decrements
//     ticks_remaining each drift tick.

export type FuelType = "avgas" | "jet-a";
export type FuelShockType =
  | "supply_tightness"
  | "glut"
  | "refinery_outage"
  | "transport_disruption";
export type FuelShockSeverity = "mild" | "moderate" | "severe";
export type FuelShockRegion = "global" | "maritime" | "east_coast";

// Per-tick random-walk amplitude. Uniform [-AMP, +AMP] applied to current.
const RANDOM_WALK_AMPLITUDE = 0.03;
// Pull-toward-base gain per tick. 0.05 means each tick we close 5% of the gap
// between current and base.
const MEAN_REVERSION_RATE = 0.05;

// Bounds (multiples of base price) under normal vs shock conditions.
const NORMAL_LOWER = 0.65;
const NORMAL_UPPER = 1.35;
const SHOCK_LOWER = 0.5;
const SHOCK_UPPER = 1.65;

export interface DriftInputs {
  currentPriceCents: number;
  basePriceCents: number;
  rng: () => number;
  // Number of drift ticks since last update. Typical value 1; >1 lets us catch
  // up after a long pause without losing variance.
  ticksSinceLastDrift: number;
  // 1.0 in normal conditions. >1 raises prices, <1 lowers them.
  shockMultiplier: number;
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export function computeNextPrice(inputs: DriftInputs): number {
  const {
    currentPriceCents,
    basePriceCents,
    rng,
    shockMultiplier,
  } = inputs;
  const ticks = Math.max(1, Math.floor(inputs.ticksSinceLastDrift));

  let price = currentPriceCents;
  for (let i = 0; i < ticks; i++) {
    const walk = (rng() * 2 - 1) * RANDOM_WALK_AMPLITUDE * basePriceCents;
    const reversion = (basePriceCents - price) * MEAN_REVERSION_RATE;
    price = price + walk + reversion;
  }

  price = price * shockMultiplier;

  const inShock = shockMultiplier !== 1;
  const lower = (inShock ? SHOCK_LOWER : NORMAL_LOWER) * basePriceCents;
  const upper = (inShock ? SHOCK_UPPER : NORMAL_UPPER) * basePriceCents;
  return Math.round(clamp(price, lower, upper));
}

// ----------------------------------------------------------------------------
// Shocks
// ----------------------------------------------------------------------------

export interface ShockEvent {
  type: FuelShockType;
  severity: FuelShockSeverity;
  multiplier: number;
  affectsFuelType: FuelType | "both";
  affectsRegion: FuelShockRegion;
  durationTicks: number;
  startedAt: number;
  description: string;
  headline: string;
}

interface ShockTemplate {
  type: FuelShockType;
  multiplierRange: [number, number];
  durationRange: [number, number];
  affectsFuelType: FuelType | "both";
  regions: FuelShockRegion[];
  // Weighting against other shock types when one fires.
  weight: number;
  buildHeadline: (severity: FuelShockSeverity) => string;
  buildDescription: (severity: FuelShockSeverity) => string;
}

const SHOCK_TEMPLATES: ShockTemplate[] = [
  {
    type: "supply_tightness",
    multiplierRange: [1.1, 1.25],
    durationRange: [8, 16],
    affectsFuelType: "jet-a",
    regions: ["global", "east_coast"],
    weight: 3,
    buildHeadline: (sev) =>
      `Jet A supply tightness — prices up ${sev === "severe" ? "sharply" : "moderately"}`,
    buildDescription: () =>
      "Pipeline allocations and refinery turnarounds are squeezing Jet A inventories. Expect higher prices and occasional FBO rationing.",
  },
  {
    type: "glut",
    multiplierRange: [0.85, 0.92],
    durationRange: [4, 8],
    affectsFuelType: "both",
    regions: ["global"],
    weight: 2,
    buildHeadline: () => "Fuel glut — prices easing across the board",
    buildDescription: () =>
      "An oversupply at the wholesale level is filtering down to FBO pumps. A short window of cheaper fuel for everyone.",
  },
  {
    type: "refinery_outage",
    multiplierRange: [1.2, 1.35],
    durationRange: [12, 24],
    affectsFuelType: "both",
    regions: ["global", "east_coast", "maritime"],
    weight: 2,
    buildHeadline: (sev) =>
      `Refinery outage — fuel prices up ${sev === "severe" ? "~30%" : "~20%"} regionally`,
    buildDescription: () =>
      "An unplanned refinery shutdown has tightened both Avgas and Jet A supply. Prices will stay elevated until product flows resume.",
  },
  {
    type: "transport_disruption",
    multiplierRange: [1.1, 1.2],
    durationRange: [6, 12],
    affectsFuelType: "both",
    regions: ["maritime", "east_coast"],
    weight: 3,
    buildHeadline: () => "Transport disruption — regional fuel prices firmer",
    buildDescription: () =>
      "Truck and barge logistics in the affected region are running behind. FBOs are passing the surcharge through at the pump.",
  },
];

const TOTAL_SHOCK_WEIGHT = SHOCK_TEMPLATES.reduce((s, t) => s + t.weight, 0);

// Probability per call that *any* shock fires. Tuned so the expected number of
// shocks per 300 calls is ~1 (matches the ~one shock per 200-400 ticks design).
const SHOCK_SPAWN_PROB = 1 / 300;

function pickInRange(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function pickIntInRange(rng: () => number, lo: number, hi: number): number {
  return Math.floor(pickInRange(rng, lo, hi + 1));
}

function pickTemplate(rng: () => number): ShockTemplate {
  const target = rng() * TOTAL_SHOCK_WEIGHT;
  let acc = 0;
  for (const t of SHOCK_TEMPLATES) {
    acc += t.weight;
    if (target < acc) return t;
  }
  return SHOCK_TEMPLATES[SHOCK_TEMPLATES.length - 1]!;
}

function severityFor(multiplier: number, type: FuelShockType): FuelShockSeverity {
  // Severity is derived from how far the multiplier strays from 1.0 — bigger
  // moves are more severe regardless of direction.
  const distance = Math.abs(multiplier - 1);
  if (type === "glut") {
    return distance >= 0.13 ? "severe" : distance >= 0.09 ? "moderate" : "mild";
  }
  return distance >= 0.25 ? "severe" : distance >= 0.15 ? "moderate" : "mild";
}

export function maybeSpawnShock(
  rng: () => number,
  simNow: number,
): ShockEvent | null {
  if (rng() >= SHOCK_SPAWN_PROB) return null;
  const template = pickTemplate(rng);
  const multiplier =
    Math.round(
      pickInRange(rng, template.multiplierRange[0], template.multiplierRange[1]) *
        100,
    ) / 100;
  const durationTicks = pickIntInRange(
    rng,
    template.durationRange[0],
    template.durationRange[1],
  );
  const region =
    template.regions[Math.floor(rng() * template.regions.length)] ?? "global";
  const severity = severityFor(multiplier, template.type);
  return {
    type: template.type,
    severity,
    multiplier,
    affectsFuelType: template.affectsFuelType,
    affectsRegion: region,
    durationTicks,
    startedAt: simNow,
    description: template.buildDescription(severity),
    headline: template.buildHeadline(severity),
  };
}

// Severity ordering used when more than one shock is active simultaneously.
// The UI surfaces only the most severe one.
const SEVERITY_ORDER: Record<FuelShockSeverity, number> = {
  mild: 0,
  moderate: 1,
  severe: 2,
};

export function compareShockSeverity(
  a: Pick<ShockEvent, "severity">,
  b: Pick<ShockEvent, "severity">,
): number {
  return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
}
