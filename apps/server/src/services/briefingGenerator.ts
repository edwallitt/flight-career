import Anthropic from "@anthropic-ai/sdk";
import {
  buildBriefingPrompt,
  getClientById,
  type BriefingContent,
} from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { airports, jobs } from "../db/schema.js";

export type BriefingResult =
  | { ok: true; briefing: BriefingContent; source: "cached" | "generated" }
  | { ok: false; error: string };

let warnedNoKey = false;
let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    if (!warnedNoKey) {
      console.warn("AI briefings disabled: ANTHROPIC_API_KEY not set");
      warnedNoKey = true;
    }
    return null;
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: key });
  }
  return cachedClient;
}

function isBriefingShape(value: unknown): value is Omit<BriefingContent, "generatedAt"> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.cargoDescription !== "string") return false;
  if (typeof v.dispatcherNote !== "string") return false;
  if (v.recipientNote !== null && typeof v.recipientNote !== "string") return false;
  if (!Array.isArray(v.handlingNotes)) return false;
  if (!v.handlingNotes.every((n) => typeof n === "string")) return false;
  return true;
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch && fenceMatch[1] ? fenceMatch[1].trim() : trimmed;
}

export async function generateBriefing(jobId: number): Promise<BriefingResult> {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return { ok: false, error: "job_not_found" };

  if (job.briefingJson) {
    try {
      const parsed = JSON.parse(job.briefingJson) as BriefingContent;
      return { ok: true, briefing: parsed, source: "cached" };
    } catch {
      // Fall through and regenerate if cache is corrupt.
    }
  }

  const client = getClient();
  if (!client) return { ok: false, error: "no_api_key" };

  const originRow = db
    .select()
    .from(airports)
    .where(eq(airports.icao, job.originIcao))
    .get();
  const destRow = db
    .select()
    .from(airports)
    .where(eq(airports.icao, job.destinationIcao))
    .get();

  let capabilities: string[] = [];
  try {
    capabilities = job.requiredCapabilitiesJson
      ? JSON.parse(job.requiredCapabilitiesJson)
      : [];
  } catch {
    capabilities = [];
  }

  const clientDef = job.clientId ? getClientById(job.clientId) : undefined;

  const { systemPrompt, userPrompt } = buildBriefingPrompt({
    clientName: clientDef?.name ?? null,
    clientRole: job.role,
    clientVoice: clientDef?.voice ?? null,
    origin: {
      icao: job.originIcao,
      name: originRow?.name ?? job.originIcao,
      size: originRow?.size ?? "unknown",
    },
    destination: {
      icao: job.destinationIcao,
      name: destRow?.name ?? job.destinationIcao,
      size: destRow?.size ?? "unknown",
    },
    payloadType: job.payloadType,
    payloadLbs: job.payloadLbs,
    paxCount: job.paxCount,
    urgency: job.urgency,
    weatherSensitivity: job.weatherSensitivity,
    requiredCapabilities: capabilities,
    pay: Math.round(job.pay / 100),
    distanceNm: Math.round(job.distanceNm),
  });

  let rawText: string;
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      temperature: 0.8,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      console.warn(`[briefing] no text block in response for job ${jobId}`);
      return { ok: false, error: "invalid_response" };
    }
    rawText = block.text;
  } catch (err) {
    console.warn(`[briefing] API call failed for job ${jobId}:`, err);
    return { ok: false, error: "api_error" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (err) {
    console.warn(`[briefing] JSON parse failed for job ${jobId}:`, err);
    return { ok: false, error: "invalid_response" };
  }

  if (!isBriefingShape(parsed)) {
    console.warn(`[briefing] response failed shape validation for job ${jobId}`);
    return { ok: false, error: "invalid_response" };
  }

  const briefing: BriefingContent = {
    cargoDescription: parsed.cargoDescription,
    dispatcherNote: parsed.dispatcherNote,
    recipientNote: parsed.recipientNote,
    handlingNotes: parsed.handlingNotes,
    generatedAt: Date.now(),
  };

  try {
    db.update(jobs)
      .set({ briefingJson: JSON.stringify(briefing) })
      .where(eq(jobs.id, jobId))
      .run();
  } catch (err) {
    console.warn(`[briefing] persist failed for job ${jobId}:`, err);
    // Still return the generated content even if cache write failed.
  }

  return { ok: true, briefing, source: "generated" };
}
