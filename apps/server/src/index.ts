import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from repo root (apps/server -> ../../.env). Idempotent and
// silently ignores a missing file. Must run before any module that reads
// process.env is imported.
try {
  process.loadEnvFile(
    resolve(fileURLToPath(import.meta.url), "../../../../.env"),
  );
} catch {
  // No .env file — fall back to whatever the shell set.
}

import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { fillBoardToTarget, tickJobGeneration } from "./services/jobBoard.js";
import {
  processMaintenanceCompletions,
  processMonthlyOwnership,
} from "./services/maintenance.js";
import { processInsurancePremiums } from "./services/insurance.js";
import { maybeRefreshMarketplace } from "./services/marketplace.js";
import { processLoanPayments } from "./services/purchase.js";
import { simBridge } from "./services/simBridge.js";
import { appRouter } from "./trpc/router.js";

const app = new Hono();

app.use("/trpc/*", cors({ origin: "http://localhost:5173" }));
app.use("/trpc/*", trpcServer({ router: appRouter }));

app.get("/", (c) => c.text("FlightCareer server"));

const port = 4000;
console.log(`FlightCareer server listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

// Boot the SimBridge connection. Wrapped — connection failures must not take
// down the server. The service handles its own retry loop internally.
try {
  simBridge.start();
} catch (err) {
  console.warn("[simBridge] start failed:", err);
}

// The world clock runs at 1× real time and persists whether the server is up
// or not, so there is no pause: tickJobGeneration() below advances simDateTime
// by the real time elapsed since the last tick. We sample every 30 real
// seconds; the first tick after boot absorbs the whole offline gap in one step.
const TICK_INTERVAL_MS = 30_000;
function runWorldTick(): void {
  try {
    const result = tickJobGeneration();
    if (result.inserted > 0 || result.expired > 0) {
      console.log(
        `[tick] +${result.inserted} jobs, expired ${result.expired}`,
      );
    }
  } catch (err) {
    console.error("[tick] failed:", err);
  }

  try {
    const loanResult = processLoanPayments();
    if (loanResult.paymentsProcessed > 0) {
      console.log(
        `[loans] ${loanResult.paymentsProcessed} payment(s), -$${(loanResult.totalDeductedCents / 100).toLocaleString()}`,
      );
    }
  } catch (err) {
    console.error("[loans] failed:", err);
  }

  try {
    const mr = processMaintenanceCompletions();
    if (mr.resolved > 0) {
      console.log(`[maintenance] ${mr.resolved} event(s) resolved`);
    }
  } catch (err) {
    console.error("[maintenance] failed:", err);
  }

  try {
    const ownership = processMonthlyOwnership();
    if (ownership.applied > 0) {
      console.log(
        `[ownership] ${ownership.applied} deduction(s), -$${(ownership.totalDeductedCents / 100).toLocaleString()}`,
      );
    }
  } catch (err) {
    console.error("[ownership] failed:", err);
  }

  try {
    const ins = processInsurancePremiums();
    if (ins.charged > 0) {
      console.log(
        `[insurance] ${ins.charged} premium(s), -$${(ins.totalCents / 100).toLocaleString()}`,
      );
    }
  } catch (err) {
    console.error("[insurance] failed:", err);
  }

  // Marketplace refresh is gated on sim-time inside maybeRefreshMarketplace
  // (every ~24 sim-hours), so call it unconditionally each tick — including
  // the boot catch-up tick, which lets a long offline gap expire stale
  // listings and refill in one pass. The old tickCount-based cadence refreshed
  // on a real-time clock that no longer matches the sim-time listing lifespans.
  try {
    const mk = maybeRefreshMarketplace();
    if (mk && (mk.added > 0 || mk.expired > 0)) {
      console.log(
        `[marketplace] +${mk.added} listings, expired ${mk.expired} (total ${mk.total})`,
      );
    }
  } catch (err) {
    console.error("[marketplace] refresh failed:", err);
  }
}

// Run one tick immediately on boot so any time that passed while the server
// was offline (job expiry, fuel drift, loan/insurance/ownership charges) is
// applied at once rather than waiting up to TICK_INTERVAL_MS for the first
// scheduled tick. That single tick expires every short-window job against the
// whole offline gap, so follow it by filling the board back to target in one
// pass — otherwise a player returning after an overnight gap opens to a sparse
// board that would only dribble back over the next few minutes of ticks.
try {
  runWorldTick();
  fillBoardToTarget();
} catch (err) {
  console.error("[boot] catch-up failed:", err);
}
setInterval(runWorldTick, TICK_INTERVAL_MS);
