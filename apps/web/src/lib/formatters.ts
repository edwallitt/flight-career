// Shared formatters. Cents → dollars, durations, sim time stamps, etc.

export function formatCash(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(dollars) >= 10_000) {
    return `$${Math.round(dollars).toLocaleString("en-US")}`;
  }
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatPay(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatSimDateTime(ms: number): string {
  const d = new Date(ms);
  const dayName = WEEKDAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayName} ${day} ${month} ${hh}:${mm} AT`;
}

export function formatRelativeFromNow(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs;
  const sign = diffMs < 0 ? "-" : "";
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  const mins = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return `${sign}${d}d ${h}h`;
  }
  if (hours > 0) return `${sign}${hours}h ${mins}m`;
  return `${sign}${mins}m`;
}

export function formatPayloadType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export const ROLE_LABEL: Record<string, string> = {
  bush: "Bush",
  air_taxi: "Air Taxi",
  light_jet: "Light Jet",
  open: "Open Market",
};
