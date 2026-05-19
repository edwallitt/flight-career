import { describe, expect, it } from "vitest";
import {
  formatCash,
  formatPay,
  formatPayloadType,
  formatRelativeFromNow,
  formatSimDateTime,
  ROLE_LABEL,
} from "../formatters.js";

describe("formatCash", () => {
  it("renders zero", () => {
    expect(formatCash(0)).toBe("$0");
  });

  it("renders sub-$10k values without rounding (integer dollars)", () => {
    expect(formatCash(1_234_56)).toBe("$1,235");
  });

  it("rounds and thousand-separates values from $10k up to $1M", () => {
    expect(formatCash(50_000_00)).toBe("$50,000");
    expect(formatCash(999_999_99)).toBe("$1,000,000");
  });

  it("collapses values >= $1M to millions with two decimals and an M suffix", () => {
    expect(formatCash(1_000_000_00)).toBe("$1.00M");
    expect(formatCash(2_500_000_00)).toBe("$2.50M");
  });

  it("handles negative cash by preserving the sign", () => {
    expect(formatCash(-50_000_00)).toBe("$-50,000");
    expect(formatCash(-1_500_000_00)).toBe("$-1.50M");
  });
});

describe("formatPay", () => {
  it("rounds to nearest dollar and thousand-separates", () => {
    expect(formatPay(0)).toBe("$0");
    expect(formatPay(1_234_56)).toBe("$1,235");
    expect(formatPay(1_234_49)).toBe("$1,234");
    expect(formatPay(50_000_00)).toBe("$50,000");
  });
});

describe("formatSimDateTime", () => {
  it("renders UTC fields with a fixed AT suffix and two-digit padding", () => {
    // 2026-05-11T09:07:00Z is a Monday.
    expect(formatSimDateTime(Date.UTC(2026, 4, 11, 9, 7))).toBe(
      "Mon 11 May 09:07 AT",
    );
  });

  it("pads single-digit day, hour, and minute", () => {
    expect(formatSimDateTime(Date.UTC(2026, 0, 5, 1, 3))).toMatch(
      /05 Jan 01:03 AT$/,
    );
  });
});

describe("formatRelativeFromNow", () => {
  const NOW = Date.UTC(2026, 4, 11, 12, 0);

  it("returns just minutes when under an hour", () => {
    expect(formatRelativeFromNow(NOW + 45 * 60_000, NOW)).toBe("45m");
  });

  it("returns hours+minutes when 1h to 24h", () => {
    expect(formatRelativeFromNow(NOW + (2 * 60 + 15) * 60_000, NOW)).toBe(
      "2h 15m",
    );
  });

  it("returns days+hours when >= 24h", () => {
    expect(formatRelativeFromNow(NOW + (3 * 24 + 5) * 60 * 60_000, NOW)).toBe(
      "3d 5h",
    );
  });

  it("prefixes a minus sign for past targets", () => {
    expect(formatRelativeFromNow(NOW - 30 * 60_000, NOW)).toBe("-30m");
    expect(formatRelativeFromNow(NOW - 4 * 60 * 60_000, NOW)).toBe("-4h 0m");
  });
});

describe("formatPayloadType", () => {
  it("capitalises the first character only", () => {
    expect(formatPayloadType("cargo")).toBe("Cargo");
    expect(formatPayloadType("pax")).toBe("Pax");
    expect(formatPayloadType("")).toBe("");
  });
});

describe("ROLE_LABEL", () => {
  it("maps every server-issued role to a display label", () => {
    expect(ROLE_LABEL.bush).toBe("Bush");
    expect(ROLE_LABEL.air_taxi).toBe("Air Taxi");
    expect(ROLE_LABEL.light_jet).toBe("Light Jet");
    expect(ROLE_LABEL.open).toBe("Open Market");
  });
});
