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
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db/client.js";
import { career } from "./db/schema.js";
import { processExams } from "./services/career.js";
import { tickJobGeneration } from "./services/jobBoard.js";
import {
  processMaintenanceCompletions,
  processMonthlyOwnership,
} from "./services/maintenance.js";
import { processInsurancePremiums } from "./services/insurance.js";
import { refreshMarketplace } from "./services/marketplace.js";
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

const TICK_INTERVAL_MS = 30_000;
let tickCount = 0;
setInterval(() => {
  // Honor the player-controlled pause. Sim time freezes, jobs don't expire,
  // fuel drift halts, marketplace doesn't refresh — exactly what the player
  // expects when they pause to plan a flight. The Force-tick mutation in the
  // jobs router still calls tickJobGeneration directly and is unaffected.
  const careerRow = db
    .select({ isPaused: career.isPaused })
    .from(career)
    .where(eq(career.id, 1))
    .get();
  if (careerRow?.isPaused) return;

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
    const examResult = processExams();
    if (examResult.resolved > 0) {
      console.log(`[exams] ${examResult.resolved} exam(s) resolved`);
    }
  } catch (err) {
    console.error("[exams] failed:", err);
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

  tickCount++;
  if (tickCount % 6 === 0) {
    try {
      const mk = refreshMarketplace();
      if (mk.added > 0 || mk.expired > 0) {
        console.log(
          `[marketplace] +${mk.added} listings, expired ${mk.expired} (total ${mk.total})`,
        );
      }
    } catch (err) {
      console.error("[marketplace] refresh failed:", err);
    }
  }
}, TICK_INTERVAL_MS);
