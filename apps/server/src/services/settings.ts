import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { settings } from "../db/schema.js";

export const SETTING_MSFS_ENABLED = "msfs_integration_enabled";

function readRaw(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

function writeRaw(key: string, value: string): void {
  const existing = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}

export function getMsfsEnabled(): boolean {
  return readRaw(SETTING_MSFS_ENABLED) === "true";
}

export function setMsfsEnabled(enabled: boolean): void {
  writeRaw(SETTING_MSFS_ENABLED, enabled ? "true" : "false");
}

/** Read a numeric setting, or null if unset / unparseable. */
export function getNumber(key: string): number | null {
  const raw = readRaw(key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Persist a numeric setting. */
export function setNumber(key: string, value: number): void {
  writeRaw(key, String(value));
}
