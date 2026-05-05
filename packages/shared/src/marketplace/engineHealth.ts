export type EngineHealthTone = "normal" | "caution" | "warning" | "critical";

export function getEngineHealthTone(
  hoursUsed: number,
  tboHours: number,
): EngineHealthTone {
  if (tboHours <= 0) return "normal";
  const ratio = Math.max(0, hoursUsed / tboHours);
  if (ratio >= 0.92) return "critical";
  if (ratio >= 0.8) return "warning";
  if (ratio >= 0.6) return "caution";
  return "normal";
}
