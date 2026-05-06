import type { ClientVoice } from "./types.js";

export interface BriefingPromptInput {
  clientName: string | null;
  clientRole: "bush" | "air_taxi" | "light_jet" | "open";
  clientVoice: ClientVoice | null;
  origin: { icao: string; name: string; size: string };
  destination: { icao: string; name: string; size: string };
  payloadType: "cargo" | "pax" | "medical" | "survey" | "mixed";
  payloadLbs: number;
  paxCount: number | null;
  urgency: "flexible" | "standard" | "urgent" | "critical";
  weatherSensitivity: "none" | "mild" | "strict";
  requiredCapabilities: string[];
  pay: number;
  distanceNm: number;
}

const BASE_SYSTEM_PROMPT = `You are a flight operations dispatcher generating a briefing for a single-pilot operator. Your output describes what's actually being flown — specific cargo, specific passengers, the human context behind the contract.

Output ONLY a JSON object matching this schema:
{
  "cargoDescription": string (1-2 sentences),
  "dispatcherNote": string (1-2 sentences in the dispatcher's voice),
  "recipientNote": string or null (1 sentence about who's receiving),
  "handlingNotes": array of 0-3 short strings
}

No preamble, no markdown, no explanation. Just the JSON object.

Constraints:
- cargoDescription should name the cargo or passengers specifically (e.g. "Three crates of veterinary supplies and a refrigerated organ shipment" not "medical cargo")
- dispatcherNote must sound like the named dispatcher wrote it
- handlingNotes should be operational ("Crates marked FRAGILE", "Patient anxious about flying") not generic
- Never refer to the pilot by name — they're "the pilot" or addressed directly with "you"
- Don't fabricate aircraft details, weather, or anything outside the job spec
- Match the urgency tone — critical jobs sound terse and important; flexible jobs sound casual`;

export function buildBriefingPrompt(input: BriefingPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (input.clientVoice) {
    systemPrompt += `\n\nVoice for this dispatch:\n- Dispatcher: ${input.clientVoice.dispatcherName}\n- Personality: ${input.clientVoice.personalityPrompt}\n- Sample tone: "${input.clientVoice.sampleNote}"`;
  } else {
    systemPrompt +=
      "\n\nThis is an open-market job — anonymous broker, no specific client. Tone is functional and impersonal.";
  }

  const paxSuffix =
    input.paxCount != null ? `, ${input.paxCount} pax` : "";
  const capabilities =
    input.requiredCapabilities.length > 0
      ? input.requiredCapabilities.join(", ")
      : "none";

  const userPrompt = `Generate a briefing for this job:

Client: ${input.clientName ?? "Open Market"}
Role: ${input.clientRole}
Route: ${input.origin.icao} (${input.origin.name}) to ${input.destination.icao} (${input.destination.name})
Distance: ${input.distanceNm}nm
Payload: ${input.payloadLbs} lbs (${input.payloadType}${paxSuffix})
Urgency: ${input.urgency}
Weather sensitivity: ${input.weatherSensitivity}
Capabilities required: ${capabilities}
Pay: $${input.pay}

Output the JSON object now.`;

  return { systemPrompt, userPrompt };
}
