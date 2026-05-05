import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { tickJobGeneration } from "./services/jobBoard.js";
import { appRouter } from "./trpc/router.js";

const app = new Hono();

app.use("/trpc/*", cors({ origin: "http://localhost:5173" }));
app.use("/trpc/*", trpcServer({ router: appRouter }));

app.get("/", (c) => c.text("FlightCareer server"));

const port = 4000;
console.log(`FlightCareer server listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

const TICK_INTERVAL_MS = 30_000;
setInterval(() => {
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
}, TICK_INTERVAL_MS);
