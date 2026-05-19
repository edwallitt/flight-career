# FlightCareer

A personal MSFS 2024 career addon for tracking VFR/IFR flights in GA aircraft and business jets. Single-user local desktop app — no auth, no multi-tenancy, no cloud. Built with React + Vite, Hono + tRPC, Drizzle + SQLite.

## Run

```sh
pnpm install
pnpm dev
```

Then open http://localhost:5173. The frontend calls `health.ping` on the backend (port 4000) via tRPC and renders the timestamp it returns.

## Layout

- `apps/web` — React + Vite + TypeScript frontend, Tailwind (dark theme), TanStack Query
- `apps/server` — Hono + tRPC + Drizzle + better-sqlite3 backend on port 4000
- `packages/shared` — Shared types, Zod schemas, pure domain logic
- `drizzle/` — Drizzle Kit migrations
- `data/career.sqlite` — SQLite database (gitignored, created at runtime)

## Tests

Every workspace uses [vitest](https://vitest.dev). Run them all:

```sh
pnpm test
```

…or target one workspace:

```sh
pnpm --filter @flightcareer/shared test   # pure-logic suites
pnpm --filter @flightcareer/server test   # services + tRPC against a test SQLite DB
pnpm --filter @flightcareer/web    test   # web helpers + React Testing Library
```

The web suite runs in jsdom with React Testing Library (`@testing-library/react`
+ `@testing-library/jest-dom`). Setup lives at
`apps/web/src/__tests__/setup.ts`; config at `apps/web/vitest.config.ts`.
