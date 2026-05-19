import { describe, expect, it } from "vitest";
import {
  ENGINE_TONE_CLASS,
  getEngineHealthTone,
  type EngineHealthTone,
} from "../engineHealth.js";

describe("ENGINE_TONE_CLASS", () => {
  it("maps every tone to a Tailwind text class", () => {
    const tones: EngineHealthTone[] = ["normal", "caution", "warning", "critical"];
    for (const tone of tones) {
      expect(ENGINE_TONE_CLASS[tone]).toMatch(/^text-/);
    }
  });

  it("escalates colour weight from normal → critical", () => {
    expect(ENGINE_TONE_CLASS.normal).toBe("text-text-high");
    expect(ENGINE_TONE_CLASS.caution).toBe("text-amber-warm");
    expect(ENGINE_TONE_CLASS.warning).toBe("text-amber-glow");
    expect(ENGINE_TONE_CLASS.critical).toBe("text-urgency-critical");
  });
});

describe("getEngineHealthTone (re-exported from shared)", () => {
  it("is callable through the web entrypoint and returns a valid tone", () => {
    expect(getEngineHealthTone(0, 2000)).toBe("normal");
    expect(getEngineHealthTone(2000, 2000)).toBe("critical");
  });
});
