# FlightCareer

A local-first MSFS 2024 career sim. Player accepts jobs, flies them in MSFS,
posts results back. The app is a dispatch tool + accounting system, not a
flight simulator.

## Workspace

pnpm monorepo. Three packages, all `@flightcareer/*`:

- `apps/server` — Hono + tRPC v11 + Drizzle + better-sqlite3. SQLite DB at
  `data/career.sqlite`.
- `apps/web` — Vite + React 18 + Tailwind + tRPC client + react-query. Has
  vitest with jsdom + React Testing Library for unit and component tests.
- `packages/shared` — pure TS, no I/O. Holds the job-generation engine, client
  definitions, and shared types/zod schemas. **vitest** lives here.

All three workspaces run vitest. The server uses a sequential file runner
(`fileParallelism: false`) because tests share a worker-scoped temp SQLite DB.

Server exposes its `AppRouter` type via the `./router` export so the web app
can `import type { AppRouter } from "@flightcareer/server/router"` for full
tRPC type inference. Don't break that export.

## Day-to-day commands

Use **pnpm**, not npm — the user's global CLAUDE.md says `npm test` etc., but
this project is pnpm-only.

- `pnpm dev` — concurrently runs server (port 4000) and web (port 5173). Kill
  any stale process on those ports first or it fails with EADDRINUSE.
- `pnpm build` — server typecheck + web tsc/build. No emit on the server.
- `pnpm typecheck` — same minus the build.
- `pnpm db:generate` — Drizzle reads `schema.ts`, writes a SQL migration to
  `drizzle/`. Run this after any schema change.
- `pnpm db:migrate` — apply pending migrations. The `apps/server/dev` script
  does NOT auto-migrate; run this explicitly.
- `pnpm --filter @flightcareer/server db:seed` — idempotent; safe to re-run.
- `pnpm test` — runs all three workspaces' vitest suites (shared → server → web).
- `pnpm --filter @flightcareer/shared test` — pure-logic suites only (fast).
- `pnpm --filter @flightcareer/server test` — service + tRPC integration suites
  (touches the test SQLite DB).
- `pnpm --filter @flightcareer/web test` — frontend unit + RTL component tests
  (jsdom env).

Definition of done before reporting a task complete: `pnpm test` (all three
workspaces green), server typecheck, and web `tsc -b` (the build step also
runs `tsc -b`).

## Domain invariants (these will bite you)

- **Money is in cents.** Career cash, job pay, fuel costs — all integer cents.
  Format with `lib/formatters.ts` (`formatCash`, `formatPay`).
- **All time is unix ms.** Two clocks coexist:
  - Real time (`Date.now()`) — used for `lastPlayedAt`, ticker scheduling.
  - **Sim time** (`career.simDateTime`) — what the player experiences. Always
    UTC. The shared generator's `simNow` is sim time.
- **The world clock runs at 1× real time and is persistent.** Each tick sets
  `simDateTime += (Date.now() − lastClockSyncReal)` (`jobBoard.ts:430-432`), so
  sim time tracks wall-clock 1:1 and the offline gap is absorbed on the first
  tick after boot. `Math.max(0, …)` guards a backwards real clock. The 30-second
  `setInterval` (`index.ts`) is just the *sync cadence*, not a fixed sim-time
  step. Because the clock only ever folds in real elapsed and never reabsorbs an
  injected jump, **do not write `simDateTime` directly to "advance" it** (e.g.
  for travel) — a one-off bump desyncs the delta math permanently. See
  `transfers_instantaneous` in auto-memory.
- **The shared package has zero I/O.** No DB, no fetch, no `Math.random()`.
  Every random branch goes through the injected `ctx.rng`. Keep it that way —
  it's why generator tests are deterministic.
- **Clients are TS code, not DB rows.** Defined in
  `packages/shared/src/clients/definitions/`, registered in `ALL_CLIENTS`.
  Their *runtime* state (mood, last interaction) is the `client_state` table.
  When you need a client by id from a row, use `getClientById`.
- **Career is a singleton at `id=1`.** Seed enforces this.
- **Reputation rows use a `scope` string** as primary key:
  - Role-level: `bush`, `air_taxi`, `light_jet`
  - Per-client: `client:<id>` (e.g. `client:maritime_cargo`)

## Job generation engine

Lives in `packages/shared/src/jobs/`. Three files:

- `pay-calculator.ts` — `calculatePay()`. Class rate per nm × payload bonus
  above a class baseline × urgency × weather × unpaved/remote bonuses ×
  `basePayMultiplier` × `(1 - familiarityDiscount)`. Rounded to whole dollars,
  returned in cents.
- `distance.ts` — `haversineNm()`.
- `generator.ts` — `runGenerationTick(clients, ctx)` returns `GeneratedJob[]`.
  The server (`services/jobBoard.ts`) is responsible for persisting them and
  advancing sim time. The engine itself never touches the DB.

Generation is **elapsed-based**, not per-tick. Each client's expected jobs for
a pass is `baseJobsPerDay × seasonal[month] × (genElapsedMs / DAY_MS)`
(`generator.ts:254`), where `genElapsedMs` is the world-time since the last
generation point, clamped to `MAX_GEN_ELAPSED_MS` (6h) so a long absence or an
abstracted-travel jump can't carpet the board. The fractional expectation is
sampled (whole part fires, fraction is a coin flip) and bounded per client. At
1× real time a 30s background tick yields ≈ `expectedPerDay × 30s/day` — so most
ticks produce nothing and a client surfaces work every few hours. Premium
templates unlock at `repInRole >= (gateMin + gateMax) / 2`, then fire 25% of the
time when unlocked. Open-market top-up is capped at +3/tick to avoid flooding.

Tests: `packages/shared/src/jobs/__tests__/generator.test.ts` use `seedrandom`
for deterministic fixtures.

## Schema notes

`apps/server/src/db/schema.ts` is the source of truth. A few things that
aren't obvious from the columns:

- `jobs.description` is a `text NOT NULL DEFAULT ''` column (added in migration
  0001). The generator's templated description text is persisted here so the
  drawer can show real flavor copy, not reconstructed fallback text.
- `jobs.legsJson` is `null` for single-leg jobs. Multi-leg is reserved for
  later.
- `jobs.requiredCapabilitiesJson` is JSON-encoded `string[]`. Decode it before
  use (`rowToListItem` does this).
- `airports.size` enum: `major | regional | small | remote`. The generator
  treats `remote` as a pay-bonus tier and biases open-market origins/dests
  toward smaller fields.

## Frontend conventions

Aesthetic is "operations-room dispatch terminal" — dense, technical, dark.

- **Type stack**: IBM Plex Sans + IBM Plex Mono (loaded from Google Fonts in
  `index.html`). Don't swap to Inter/Geist/Space Grotesk.
- **Palette tokens** (in `tailwind.config.js`): `ink-{500..900}` for surfaces,
  `amber-{glow,warm,deep,dim}` for the single accent, `urgency-*` for status
  colors, `muted{,-dim,-faint}` for hierarchy text. Don't introduce new
  ad-hoc colors — extend the palette instead.
- **Custom utilities**: `tracking-callsign` (0.18em) for ICAO/code labels,
  `text-micro`/`text-tiny` for caption sizes, `.label`/`.icao` component
  classes in `index.css`.
- **Numbers**: always tabular. Use `tabular-nums` or the `.num`/`.mono` helper
  classes. ICAO codes go in mono with letter-spacing.
- **Routing**: react-router-dom v6, `BrowserRouter` in `main.tsx`.
- **Data fetching**: tRPC + react-query. The list query auto-refetches every
  10s; `career.get` every 5s. Mutations should `invalidate` whatever they
  affect (the tick mutation invalidates both `jobs.list` and `career.get`).

The Force Tick button is a dev affordance — it triggers the server's
`tickJobGeneration` immediately and shows `+N new · M aged out` feedback. Plan
to hide it behind a dev flag once the player progression loop lands.

## Testing

### Automated tests

Each workspace has its own vitest config. Run them all with `pnpm test`, or
target one workspace with `pnpm --filter @flightcareer/<name> test`.

- **`packages/shared`** — pure-logic suites for the job generator, pay
  calculator, marketplace/maintenance pricing, lifecycle helpers, etc. No DB,
  no I/O. Deterministic via `seedrandom`. Add new shared tests under
  `<module>/__tests__/*.test.ts`.

- **`apps/server`** — service + tRPC tests against a real SQLite database.
  - Config: `apps/server/vitest.config.ts` (`fileParallelism: false`, setup file
    at `src/__tests__/helpers/setup-env.ts`).
  - Shared fixtures: `src/__tests__/helpers/fixtures.ts` exports `resetTestDb`,
    `insertJob`, `insertOwnedAircraft`, `insertFlight`, `getCareer`. Catalog
    tables (airports, aircraft types) are seeded once per worker; mutable rows
    are wiped between tests with FKs temporarily off. `resetTestDb` accepts
    overrides for `cash`, `simNow`, `currentLocation`, `startingRoleRep`,
    `ratingsEarned`, `rentalsAt`.
  - Default fixture state: career `id=1`, pilot `TestPilot`, cash `$10k`,
    location `CYHZ`, sim time `2026-01-01 UTC`, SEP rating earned, role rep 25,
    a bonanza_g36 rental at the player's location.
  - Pattern: `beforeEach(() => resetTestDb({ ... }))`, then drive the service
    you're testing and assert on rows via Drizzle.

- **`apps/web`** — vitest in jsdom + React Testing Library.
  - Config: `apps/web/vitest.config.ts` (jsdom env, react plugin).
  - Setup: `apps/web/src/__tests__/setup.ts` installs
    `@testing-library/jest-dom/vitest` matchers and runs `cleanup()` after each
    test (vitest with `globals: false` doesn't auto-cleanup).
  - Use this for: pure web helpers (`lib/formatters.ts`,
    `lib/engineHealth.ts`), and component rendering tests via RTL.
  - Component tests should use `screen.getByText` / `getByRole` (avoid
    snapshotting the dispatch-terminal markup — corner ticks and class soup
    make snapshots noisy and useless).
  - Components that hit the tRPC client need a query client + tRPC provider
    wrapper; no fixture for that exists yet — add one when the first such test
    lands.

### Manual / browser testing

For UI work you can also drive the app directly via the Claude-in-Chrome
plugin (connect to Chrome, navigate to `http://localhost:5173`, interact).
Useful for visual regressions and end-to-end smoke checks that RTL can't
cover.

## What's intentionally stubbed

Most of what this section used to list is now fully built: job acceptance,
aircraft selection/dispatch, the brief → begin → complete lifecycle, travel,
hangar, marketplace, maintenance, insurance, and every route (`/hangar`,
`/career`, `/logbook`, `/map`, `/market`, `/settings`) are live. There are no
`alert(…)` stubs left in `apps/web`, and `ComingSoon` is no longer routed
(component retained but dead). What genuinely remains inert:

- **Familiarity discount** — passed to `calculatePay` but hardcoded to 0 at
  both generator call sites (`generator.ts`). `reputationByClient` is wired
  through `GenerationContext` for future use (premium gating, negotiation) but
  doesn't affect pay yet.
- **Rating exams resolve instantly** — `bookExam` (`services/career.ts`) grants
  the rating on payment of the fee once hour gates are met. The `rating_exams`
  scheduling schema (`scheduledFor`, `examLeadDays`, booked/failed states) is
  scaffolded but short-circuited; there's no wait or fail roll.
- **Manual completion is honor-system** — in untracked mode the player
  self-reports block time and destination; only the (optional, external)
  SimBridge WebSocket path is authoritative.
- **Vestigial `owned_aircraft.hoursSinceAnnual`** — `annualDueAt` is the
  canonical annual clock; the owned column accumulates block hours and is no
  longer read for owned-aircraft risk/pricing (those derive days from
  `annualDueAt`). A schema-level removal is a tracked follow-up.

## Auto memory

The user has `~/.claude/projects/-Users-edwardwallitt-Code-flight-career/memory/`
with a memory index and topic files. Honor entries in
`feedback_verification_scope.md` etc. before redoing work.
