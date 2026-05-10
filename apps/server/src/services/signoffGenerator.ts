import Anthropic from "@anthropic-ai/sdk";
import {
  buildSignoffPrompt,
  type SignoffPromptInput,
} from "@flightcareer/shared";

const MAX_SIGNOFF_CHARS = 250;

let warnedNoKey = false;
let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    if (!warnedNoKey) {
      console.warn("AI sign-offs disabled: ANTHROPIC_API_KEY not set");
      warnedNoKey = true;
    }
    return null;
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: key });
  }
  return cachedClient;
}

function sanitize(raw: string): string | null {
  let text = raw.trim();
  // Strip surrounding single or double quotes if the model wrapped its output.
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  if (!text) return null;
  if (text.length > MAX_SIGNOFF_CHARS) return null;
  return text;
}

export async function generateSignoff(
  input: SignoffPromptInput,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const { systemPrompt, userPrompt } = buildSignoffPrompt(input);
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      temperature: 0.85,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      console.warn("[signoff] no text block in response");
      return null;
    }
    return sanitize(block.text);
  } catch (err) {
    console.warn("[signoff] generation failed:", err);
    return null;
  }
}
