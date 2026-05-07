import { describe, expect, it } from "vitest";
import { buildBriefingPrompt, type BriefingPromptInput } from "../prompt.js";
import type { ClientVoice } from "../types.js";

const VOICE: ClientVoice = {
  dispatcherName: "Marcie",
  personalityPrompt: "Direct, dry, no small talk. Calls the pilot 'cap'.",
  sampleNote: "Two crates on the ramp. Skids fwd. Don't be late.",
};

function input(over: Partial<BriefingPromptInput> = {}): BriefingPromptInput {
  return {
    clientName: "Maritime Cargo",
    clientRole: "bush",
    clientVoice: VOICE,
    origin: { icao: "CYHZ", name: "Halifax", size: "major" },
    destination: { icao: "CYQI", name: "Yarmouth", size: "regional" },
    payloadType: "cargo",
    payloadLbs: 600,
    paxCount: null,
    urgency: "standard",
    weatherSensitivity: "mild",
    requiredCapabilities: [],
    pay: 1200,
    distanceNm: 140,
    ...over,
  };
}

describe("buildBriefingPrompt", () => {
  it("returns both system and user prompts", () => {
    const out = buildBriefingPrompt(input());
    expect(typeof out.systemPrompt).toBe("string");
    expect(typeof out.userPrompt).toBe("string");
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(out.userPrompt.length).toBeGreaterThan(0);
  });

  it("declares the JSON-only output schema in the system prompt", () => {
    const out = buildBriefingPrompt(input());
    expect(out.systemPrompt).toContain("cargoDescription");
    expect(out.systemPrompt).toContain("dispatcherNote");
    expect(out.systemPrompt).toContain("recipientNote");
    expect(out.systemPrompt).toContain("handlingNotes");
    expect(out.systemPrompt).toContain("Output ONLY a JSON object");
  });

  it("appends the client voice block when a voice is supplied", () => {
    const out = buildBriefingPrompt(input());
    expect(out.systemPrompt).toContain("Voice for this dispatch");
    expect(out.systemPrompt).toContain("Marcie");
    expect(out.systemPrompt).toContain(VOICE.personalityPrompt);
    expect(out.systemPrompt).toContain(VOICE.sampleNote);
  });

  it("uses the open-market line when no voice is supplied", () => {
    const out = buildBriefingPrompt(
      input({ clientVoice: null, clientName: null }),
    );
    expect(out.systemPrompt).toContain("open-market job");
    expect(out.systemPrompt).not.toContain("Voice for this dispatch");
  });

  it("renders the route, payload, and pay in the user prompt", () => {
    const out = buildBriefingPrompt(input());
    expect(out.userPrompt).toContain("CYHZ (Halifax)");
    expect(out.userPrompt).toContain("CYQI (Yarmouth)");
    expect(out.userPrompt).toContain("140nm");
    expect(out.userPrompt).toContain("600 lbs");
    expect(out.userPrompt).toContain("$1200");
    expect(out.userPrompt).toContain("Maritime Cargo");
  });

  it("falls back to 'Open Market' when clientName is null", () => {
    const out = buildBriefingPrompt(
      input({ clientName: null, clientVoice: null }),
    );
    expect(out.userPrompt).toContain("Open Market");
  });

  it("includes the pax count suffix when paxCount is set", () => {
    const out = buildBriefingPrompt(
      input({ payloadType: "pax", paxCount: 3 }),
    );
    expect(out.userPrompt).toContain("(pax, 3 pax)");
  });

  it("omits the pax suffix when paxCount is null", () => {
    const out = buildBriefingPrompt(input({ paxCount: null }));
    // Should be "(cargo)" without a trailing pax count
    expect(out.userPrompt).toContain("(cargo)");
    expect(out.userPrompt).not.toMatch(/\(cargo, \d+ pax\)/);
  });

  it("renders 'none' when no capabilities are required", () => {
    const out = buildBriefingPrompt(input({ requiredCapabilities: [] }));
    expect(out.userPrompt).toContain("Capabilities required: none");
  });

  it("joins required capabilities with commas", () => {
    const out = buildBriefingPrompt(
      input({ requiredCapabilities: ["unpaved", "float"] }),
    );
    expect(out.userPrompt).toContain("Capabilities required: unpaved, float");
  });

  it("propagates urgency and weather-sensitivity values into the prompt", () => {
    const out = buildBriefingPrompt(
      input({ urgency: "critical", weatherSensitivity: "strict" }),
    );
    expect(out.userPrompt).toContain("Urgency: critical");
    expect(out.userPrompt).toContain("Weather sensitivity: strict");
  });
});
