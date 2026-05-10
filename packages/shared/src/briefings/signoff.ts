import { FERRY_VOICE_PROFILES, type FerrySourceType } from "../jobs/ferry.js";
import type { ClientVoice } from "./types.js";

export type SignoffReputationTier =
  | "unproven"
  | "novice"
  | "mid"
  | "high"
  | "top";

export type SignoffJobType = "standard" | "ferry";
export type SignoffOutcome = "completed" | "diverted" | "failed";
export type SignoffEventSeverity = "light" | "moderate" | "severe";

export interface SignoffPromptInput {
  jobType: SignoffJobType;
  clientName: string | null;
  clientRole: "bush" | "air_taxi" | "light_jet" | "open";
  clientVoice: ClientVoice | null;
  ferrySource: FerrySourceType | null;
  ferryOwnerName: string | null;

  outcome: SignoffOutcome;
  divertedFromIcao: string | null;
  actualDestinationIcao: string;

  unscheduledEvent: {
    severity: SignoffEventSeverity;
    description: string;
  } | null;

  reputationTier: SignoffReputationTier;
  flightsWithThisClient: number;

  originIcao: string;
  blockTimeMinutes: number;
  payCents: number;
}

const BASE_SYSTEM_PROMPT = `You are a flight operations dispatcher writing a brief sign-off message to a contract pilot who has just completed a flight. This is the human moment after the work is done.

Output ONLY the message text. One or two sentences. No preamble, no JSON, no quotes around the output.

Constraints:
- 1-2 sentences only. Brief.
- Match the established dispatcher voice exactly.
- Acknowledge the SPECIFIC outcome (success / diversion / event).
- Tone scales with the pilot relationship: unproven gets professional, novice gets encouraging, mid/high/top get warmth and familiarity.
- Don't promise future work. Don't reference upcoming jobs.
- Don't reference the pilot by name (you don't know their name).
- Don't repeat numerical facts the UI already shows (pay, distance, time).`;

const OPEN_MARKET_ADDENDUM = `

This is an open-market job — anonymous broker, no relationship. Tone is functional and impersonal. Just acknowledge completion with minimal warmth. Ignore relationship context.`;

const FERRY_ADDENDUM = `

This is ferry/repositioning work — a one-off contract, not an ongoing client relationship. Tone is professional and transactional unless the source's voice profile is personal (private owner). Ignore the reputation tier — treat the pilot as a hired ferry pilot, not a relationship.`;

function tierGuidance(tier: SignoffReputationTier): string {
  switch (tier) {
    case "unproven":
      return "Relationship tone: UNPROVEN. The pilot has not worked with this dispatcher before — be professional and formal. No warmth, no familiarity. Acknowledge the work, nothing more.";
    case "novice":
      return "Relationship tone: NOVICE. The pilot has flown a handful of jobs for this dispatcher — be warmer and encouraging, but still slightly reserved. They're proving themselves.";
    case "mid":
      return "Relationship tone: MID. The pilot is a known regular — casual, familiar, can name specific people on the dispatcher's end. Comfortable banter is welcome.";
    case "high":
      return "Relationship tone: HIGH. The pilot is a trusted regular — warm, specific, light teasing or shared in-jokes are appropriate. The dispatcher genuinely likes working with them.";
    case "top":
      return "Relationship tone: TOP. Insider warmth, near-friendship. The dispatcher speaks to the pilot like a member of the team — affectionate, candid, casual.";
  }
}

export function buildSignoffPrompt(input: SignoffPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (input.jobType === "ferry") {
    systemPrompt += FERRY_ADDENDUM;
    if (input.ferrySource && input.ferryOwnerName) {
      const profile = FERRY_VOICE_PROFILES[input.ferrySource];
      const dispatcherName = profile.dispatcherTemplate.replace(
        "{ownerName}",
        input.ferryOwnerName,
      );
      const sample = profile.sampleNote.replace(
        "{ownerName}",
        input.ferryOwnerName,
      );
      systemPrompt += `\n\nYou are: ${dispatcherName}\nPersonality: ${profile.personalityPrompt}\nSample tone: "${sample}"`;
    }
  } else if (input.clientRole === "open" || !input.clientVoice) {
    systemPrompt += OPEN_MARKET_ADDENDUM;
  } else {
    systemPrompt += `\n\nYou are: ${input.clientVoice.dispatcherName}\nPersonality: ${input.clientVoice.personalityPrompt}\nSample tone: "${input.clientVoice.sampleNote}"`;
    systemPrompt += `\n\n${tierGuidance(input.reputationTier)}`;
  }

  const outcomeLine = (() => {
    if (input.outcome === "completed") {
      return `Arrived at ${input.actualDestinationIcao} as planned.`;
    }
    if (input.outcome === "diverted") {
      const from = input.divertedFromIcao
        ? `from planned destination (${input.divertedFromIcao}) `
        : "";
      return `Diverted ${from}to actual destination (${input.actualDestinationIcao}). The pilot got the aircraft on the ground safely but not where the dispatcher expected.`;
    }
    return "Flight failed to complete the delivery.";
  })();

  const eventLine = input.unscheduledEvent
    ? `\nMid-flight event: ${input.unscheduledEvent.severity} — ${input.unscheduledEvent.description}\nThe pilot dealt with this and got the aircraft on the ground.`
    : "";

  const relationshipLine =
    input.jobType === "ferry" || input.clientRole === "open"
      ? ""
      : `\nRelationship context:\n- This is flight #${input.flightsWithThisClient + 1} with this dispatcher\n- Reputation tier: ${input.reputationTier}${
          input.flightsWithThisClient === 0
            ? "\n- This is your first time working with this pilot."
            : ""
        }`;

  const userPrompt = `Generate a sign-off for this completed flight:

Outcome: ${input.outcome}
${outcomeLine}${eventLine}${relationshipLine}

Trip:
- Block time: ${input.blockTimeMinutes} minutes
- Origin: ${input.originIcao}
- Destination: ${input.actualDestinationIcao}

Output the sign-off message now.`;

  return { systemPrompt, userPrompt };
}
