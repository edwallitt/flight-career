// Smoke test for fuel drift end-to-end. Hits the live DB.
// Run with: pnpm --filter @flightcareer/server exec tsx src/scripts/smoke-fuel-drift.ts

import { db } from "../db/client.js";
import {
  fuelPriceCurrent,
  fuelPriceSnapshots,
} from "../db/schema.js";
import {
  ensureFuelPriceCurrent,
  forceSpawnShock,
  getActiveShocks,
  getFuelPriceHistory,
  getHeadlineShock,
  processFuelDriftTick,
} from "../services/fuelDrift.js";

const now = Date.now();
ensureFuelPriceCurrent(now);
console.log("fuel_price_current rows:", db.select().from(fuelPriceCurrent).all().length);

forceSpawnShock({
  type: "refinery_outage",
  severity: "moderate",
  multiplier: 1.25,
  affectsFuelType: "both",
  affectsRegion: "global",
  durationTicks: 4,
  startedAt: now,
  description: "smoke test refinery outage",
  headline: "Smoke: refinery outage — prices up ~25%",
});

const beforeSample = db.select().from(fuelPriceCurrent).limit(3).all();
console.log("before:", beforeSample.map((r) => `${r.airportIcao}/${r.fuelType}=${r.currentPriceCents}`).join(", "));

for (let i = 1; i <= 5; i++) {
  const r = processFuelDriftTick(now + i * 6 * 60 * 60 * 1000);
  console.log(
    `tick ${i}: updated=${r.airportsUpdated}, snapshots=${r.snapshotsCreated}, expired=${r.shocksExpired}, spawned=${r.shockEvent ? "yes" : "no"}`,
  );
}

const afterSample = db.select().from(fuelPriceCurrent).limit(3).all();
console.log("after:", afterSample.map((r) => `${r.airportIcao}/${r.fuelType}=${r.currentPriceCents}`).join(", "));

console.log("active shocks:", getActiveShocks().length);
console.log("headline:", getHeadlineShock()?.headline ?? "(none)");
console.log("total snapshots:", db.select().from(fuelPriceSnapshots).all().length);
const sample = db.select().from(fuelPriceCurrent).limit(1).all()[0];
if (sample) {
  const history = getFuelPriceHistory({
    airportIcao: sample.airportIcao,
    fuelType: sample.fuelType,
    windowDays: 30,
  });
  console.log(`history for ${sample.airportIcao}/${sample.fuelType}: ${history.length} points`);
}
