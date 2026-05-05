import type { EngineHealthTone } from "@flightcareer/shared";

export { getEngineHealthTone } from "@flightcareer/shared";
export type { EngineHealthTone } from "@flightcareer/shared";

export const ENGINE_TONE_CLASS: Record<EngineHealthTone, string> = {
  normal: "text-text-high",
  caution: "text-amber-warm",
  warning: "text-amber-glow",
  critical: "text-urgency-critical",
};
