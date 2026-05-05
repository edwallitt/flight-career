import { describe, expect, it } from "vitest";
import { getEngineHealthTone } from "../engineHealth.js";

describe("getEngineHealthTone", () => {
  it("returns normal for fresh engines (< 60%)", () => {
    expect(getEngineHealthTone(0, 2000)).toBe("normal");
    expect(getEngineHealthTone(500, 2000)).toBe("normal");
    expect(getEngineHealthTone(1199, 2000)).toBe("normal");
  });

  it("returns caution at 60-80%", () => {
    expect(getEngineHealthTone(1200, 2000)).toBe("caution");
    expect(getEngineHealthTone(1500, 2000)).toBe("caution");
    expect(getEngineHealthTone(1599, 2000)).toBe("caution");
  });

  it("returns warning at 80-92%", () => {
    expect(getEngineHealthTone(1600, 2000)).toBe("warning");
    expect(getEngineHealthTone(1800, 2000)).toBe("warning");
    expect(getEngineHealthTone(1839, 2000)).toBe("warning");
  });

  it("returns critical at 92%+", () => {
    expect(getEngineHealthTone(1840, 2000)).toBe("critical");
    expect(getEngineHealthTone(1999, 2000)).toBe("critical");
    expect(getEngineHealthTone(2500, 2000)).toBe("critical");
  });

  it("returns normal when tboHours is non-positive", () => {
    expect(getEngineHealthTone(500, 0)).toBe("normal");
    expect(getEngineHealthTone(500, -1)).toBe("normal");
  });

  it("treats negative hours as zero usage", () => {
    expect(getEngineHealthTone(-5, 2000)).toBe("normal");
  });
});
