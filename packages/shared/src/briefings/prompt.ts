import { FERRY_VOICE_PROFILES, type FerrySourceType } from "../jobs/ferry.js";
import type { ClientVoice } from "./types.js";

export interface FerryBriefingContext {
  source: FerrySourceType;
  ownerName: string;
  aircraftLabel: string;
  tail: string;
  aircraftClass: "SEP" | "MEP" | "SET" | "JET";
}

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
  // Set when the job is a ferry/repositioning contract — the briefing focuses
  // on the aircraft and the source's voice rather than cargo/passengers.
  ferry?: FerryBriefingContext | null;
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

const FERRY_SYSTEM_ADDENDUM = `

This is a FERRY / repositioning contract. The pilot is being hired by an aircraft owner, dealer, or charter operator to move a specific aircraft from one airport to another. There is no cargo or passengers — just the aircraft itself.

Adapt the JSON shape to the ferry context:
- "cargoDescription": one or two sentences describing why this aircraft is being moved (sale logistics, owner relocation, charter pre-position, hangar swap, post-maintenance repositioning) — NOT cargo or passengers.
- "dispatcherNote": in the source's voice; mention the specific aircraft tail and where the ferry pilot will hand it over.
- "recipientNote": who is receiving the aircraft at destination (buyer, charter crew, hangar staff) — or null if not relevant.
- "handlingNotes": ferry-relevant items only (aircraft quirks the owner mentions, paperwork in the cabin, time-sensitive downstream flights, any specific instructions about start-up, taxi, or shutdown).
Do NOT mention cargo weight, passengers, or "the cargo".`;

export function buildBriefingPrompt(input: BriefingPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  let systemPrompt = BASE_SYSTEM_PROMPT;
  const ferry = input.ferry ?? null;

  if (ferry) {
    systemPrompt += FERRY_SYSTEM_ADDENDUM;
    const profile = FERRY_VOICE_PROFILES[ferry.source];
    const dispatcherName = profile.dispatcherTemplate.replace(
      "{ownerName}",
      ferry.ownerName,
    );
    const sample = profile.sampleNote
      .replace("{tail}", ferry.tail)
      .replace("{ownerName}", ferry.ownerName);
    systemPrompt += `\n\nVoice for this ferry:\n- Dispatcher: ${dispatcherName}\n- Personality: ${profile.personalityPrompt}\n- Sample tone: "${sample}"`;
  } else if (input.clientVoice) {
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

  const userPrompt = ferry
    ? `Generate a ferry briefing for this contract:

Source: ${ferry.source} — ${ferry.ownerName}
Aircraft: ${ferry.aircraftLabel} (${ferry.aircraftClass}, tail ${ferry.tail})
Route: ${input.origin.icao} (${input.origin.name}) to ${input.destination.icao} (${input.destination.name})
Distance: ${input.distanceNm}nm
Urgency: ${input.urgency}
Weather sensitivity: ${input.weatherSensitivity}
Pay: $${input.pay}

Output the JSON object now.`
    : `Generate a briefing for this job:

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
