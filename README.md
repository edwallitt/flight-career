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
