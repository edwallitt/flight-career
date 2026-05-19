import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { settings } from "../../db/schema.js";
import { resetTestDb } from "../../__tests__/helpers/fixtures.js";
import {
  getMsfsEnabled,
  setMsfsEnabled,
  SETTING_MSFS_ENABLED,
} from "../settings.js";

describe("MSFS integration setting", () => {
  beforeEach(() => resetTestDb());

  it("defaults to false when the row doesn't exist", () => {
    expect(getMsfsEnabled()).toBe(false);
  });

  it("setMsfsEnabled(true) inserts a row and persists across reads", () => {
    setMsfsEnabled(true);
    expect(getMsfsEnabled()).toBe(true);
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTING_MSFS_ENABLED))
      .get();
    expect(row).toBeDefined();
    expect(row!.value).toBe("true");
  });

  it("setMsfsEnabled(false) overwrites an existing true row without duplicating", () => {
    setMsfsEnabled(true);
    setMsfsEnabled(false);
    expect(getMsfsEnabled()).toBe(false);

    const rows = db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTING_MSFS_ENABLED))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("false");
  });

  it("only flips on the literal string 'true' — guards against stray values", () => {
    db.insert(settings)
      .values({ key: SETTING_MSFS_ENABLED, value: "yes" })
      .run();
    expect(getMsfsEnabled()).toBe(false);
  });
});
