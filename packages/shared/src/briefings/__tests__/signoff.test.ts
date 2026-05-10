import { describe, expect, it } from "vitest";
import { buildSignoffPrompt, type SignoffPromptInput } from "../signoff.js";
import type { ClientVoice } from "../types.js";

const VOICE: ClientVoice = {
  dispatcherName: "Marie",
  personalityPrompt: "Warm. Knows the regulars.",
  sampleNote: "Sample — winds were tricky out there.",
};

function input(over: Partial<SignoffPromptInput> = {}): SignoffPromptInput {
  return {
    jobType: "standard",
    clientName: "Northern Outfitters",
    clientRole: "bush",
    clientVoice: VOICE,
    ferrySource: null,
    ferryOwnerName: null,
    outcome: "completed",
    divertedFromIcao: null,
    actualDestinationIcao: "CYHZ",
    unscheduledEvent: null,
    reputationTier: "mid",
    flightsWithThisClient: 6,
    originIcao: "CYQI",
    blockTimeMinutes: 75,
    payCents: 120_000,
    ...over,
  };
}

describe("buildSignoffPrompt", () => {
  it("returns both system and user prompts", () => {
    const out = buildSignoffPrompt(input());
    expect(typeof out.systemPrompt).toBe("string");
    expect(typeof out.userPrompt).toBe("string");
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(out.userPrompt.length).toBeGreaterThan(0);
  });

  it("embeds the client voice for standard jobs", () => {
    const out = buildSignoffPrompt(input());
    expect(out.systemPrompt).toContain("Marie");
    expect(out.systemPrompt).toContain("Warm. Knows the regulars.");
  });

  it("scales tone language to the reputation tier", () => {
    const tiers = ["unproven", "novice", "mid", "high", "top"] as const;
    for (const t of tiers) {
      const out = buildSignoffPrompt(input({ reputationTier: t }));
      expect(out.systemPrompt).toContain(t.toUpperCase());
    }
  });

  it("describes a completed flight with the actual destination", () => {
    const out = buildSignoffPrompt(input({ actualDestinationIcao: "CYHZ" }));
    expect(out.userPrompt).toContain("Outcome: completed");
    expect(out.userPrompt).toContain("CYHZ");
  });

  it("describes a diverted flight including the planned destination", () => {
    const out = buildSignoffPrompt(
      input({
        outcome: "diverted",
        divertedFromIcao: "CYQM",
        actualDestinationIcao: "CYHZ",
      }),
    );
    expect(out.userPrompt).toContain("Outcome: diverted");
    expect(out.userPrompt).toContain("CYQM");
    expect(out.userPrompt).toContain("CYHZ");
  });

  it("describes a failed flight without inventing a planned destination", () => {
    const out = buildSignoffPrompt(input({ outcome: "failed" }));
    expect(out.userPrompt).toContain("Outcome: failed");
    expect(out.userPrompt).toContain("failed to complete");
  });

  it("includes the unscheduled event when one occurred", () => {
    const out = buildSignoffPrompt(
      input({
        unscheduledEvent: {
          severity: "moderate",
          description: "Alternator failure en route",
        },
      }),
    );
    expect(out.userPrompt).toContain("Mid-flight event");
    expect(out.userPrompt).toContain("moderate");
    expect(out.userPrompt).toContain("Alternator failure en route");
  });

  it("omits relationship context for open-market jobs", () => {
    const out = buildSignoffPrompt(
      input({
        clientName: null,
        clientRole: "open",
        clientVoice: null,
        reputationTier: "unproven",
        flightsWithThisClient: 0,
      }),
    );
    expect(out.systemPrompt).toContain("open-market");
    expect(out.systemPrompt).not.toContain("Marie");
    expect(out.userPrompt).not.toContain("Relationship context");
  });

  it("switches to ferry voice for ferry jobs", () => {
    const out = buildSignoffPrompt(
      input({
        jobType: "ferry",
        clientName: "Mr. Chen",
        clientVoice: null,
        clientRole: "bush",
        ferrySource: "owner",
        ferryOwnerName: "Mr. Chen",
      }),
    );
    expect(out.systemPrompt).toContain("ferry");
    expect(out.systemPrompt).toContain("Mr. Chen");
    // Ferry prompts ignore relationship context.
    expect(out.userPrompt).not.toContain("Relationship context");
  });

  it("uses operator voice for charter ferry sources", () => {
    const out = buildSignoffPrompt(
      input({
        jobType: "ferry",
        clientName: "Premium Charter Group",
        clientVoice: null,
        clientRole: "light_jet",
        ferrySource: "operator",
        ferryOwnerName: "Premium Charter Group",
      }),
    );
    expect(out.systemPrompt).toContain("Operations · Premium Charter Group");
  });

  it("flags first-time pilot encounters for the dispatcher", () => {
    const out = buildSignoffPrompt(
      input({ flightsWithThisClient: 0, reputationTier: "unproven" }),
    );
    expect(out.userPrompt).toContain("flight #1");
    expect(out.userPrompt).toContain("first time working with this pilot");
  });
});
