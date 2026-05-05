import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each worker process gets its own temp DB. Set the env var BEFORE the
// db/client.ts singleton is imported anywhere — that's why the imports
// below are dynamic and live after this assignment.
const tmpDir = mkdtempSync(join(tmpdir(), "flightcareer-test-"));
process.env.CAREER_DB_PATH = join(tmpDir, "career.sqlite");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { db } = await import("../../db/client.js");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../../../../drizzle");
migrate(db, { migrationsFolder });
