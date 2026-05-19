// Advisory guard: insurance must stay NET-NEGATIVE in expectation.
//
// This is intentionally a coarse statistical simulation with a fixed seed.
// Its only job is to catch a future tuning change that accidentally makes
// insurance profitable for the player. It is NOT a balance test — if it
// fails, do not silently retune INSURANCE_TIERS to pass it; surface the
// failure and the empirical ratio (see tiers.ts tuning-intent comment).

import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import { generateEvent } from "../../maintenance/events.js";
import { resolveClaim } from "../claim.js";
import { quotePremium } from "../premium.js";

describe("insurance net-negative-in-expectation (advisory)", () => {
  it("Standard premiums comfortably exceed insurer payouts for a typical operator", () => {
    const rng = seedrandom("insurance-net-negative-fixed-seed");

    // A representative mid-GA owned aircraft, conscientiously maintained so
    // it sits in the lower risk band most of its life.
    const insuredValueCents = 20_000_000; // $200k
    const riskTier = "monitor" as const;
    const aircraftType = {
      fuelType: "avgas" as const,
      aircraftClass: "SEP" as const,
      overhaulCostCents: 4_000_000, // $40k
      annualCostCents: 600_000,
    };

    const months = 240; // 20 sim years
    const flightHoursPerMonth = 40; // an active operator
    // Monitor tier ≈ 0.015 unscheduled events per flight hour (the model's
    // monitor band is [0.01, 0.025) — take a representative mid value).
    const eventsPerHour = 0.015;
    const expectedEventsPerMonth = flightHoursPerMonth * eventsPerHour;

    const premium = quotePremium({
      tier: "standard",
      insuredValueCents,
      riskTier,
      cannotDispatch: false,
    }).monthlyPremiumCents;

    let totalPremiums = 0;
    let totalInsurerPayouts = 0;

    for (let m = 0; m < months; m++) {
      totalPremiums += premium;

      // Poisson-ish: draw a small integer count of events this month.
      let events = Math.floor(expectedEventsPerMonth);
      if (rng() < expectedEventsPerMonth - events) events += 1;

      for (let e = 0; e < events; e++) {
        const event = generateEvent({
          riskTier,
          factors: [],
          aircraftType,
          rng,
        });
        const outcome = resolveClaim({
          policyTier: "standard",
          eventSeverity: event.severity,
          eventCostCents: event.costCents,
        });
        totalInsurerPayouts += outcome.insurerPaidCents;
      }
    }

    const ratio = totalPremiums / Math.max(1, totalInsurerPayouts);
    // Report the empirical ratio so a future tuning pass can see the margin.
    // eslint-disable-next-line no-console
    console.log(
      `[insurance net-negative] premiums=$${(totalPremiums / 100).toFixed(0)} ` +
        `payouts=$${(totalInsurerPayouts / 100).toFixed(0)} ratio=${ratio.toFixed(2)}x`,
    );

    // Premiums must comfortably exceed payouts. K=1.05 is a deliberately
    // loose floor — the design target is well above this; this only trips if
    // a change makes insurance roughly break-even or profitable.
    expect(totalPremiums).toBeGreaterThan(totalInsurerPayouts * 1.05);
  });
});
