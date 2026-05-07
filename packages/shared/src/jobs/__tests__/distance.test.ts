import { describe, expect, it } from "vitest";
import { haversineNm } from "../distance.js";

describe("haversineNm", () => {
  it("returns 0 for the same point", () => {
    const p = { lat: 44.8808, lon: -63.5086 };
    expect(haversineNm(p, p)).toBe(0);
  });

  it("is symmetric in its arguments", () => {
    const a = { lat: 44.8808, lon: -63.5086 }; // CYHZ
    const b = { lat: 47.6186, lon: -52.7519 }; // CYYT
    expect(haversineNm(a, b)).toBeCloseTo(haversineNm(b, a), 6);
  });

  it("matches the known great-circle distance between CYHZ and CYYT (~471 nm)", () => {
    const cyhz = { lat: 44.8808, lon: -63.5086 };
    const cyyt = { lat: 47.6186, lon: -52.7519 };
    const d = haversineNm(cyhz, cyyt);
    expect(d).toBeGreaterThan(465);
    expect(d).toBeLessThan(480);
  });

  it("matches the known great-circle distance between KBOS and CYHZ (~360 nm)", () => {
    const kbos = { lat: 42.3656, lon: -71.0096 };
    const cyhz = { lat: 44.8808, lon: -63.5086 };
    const d = haversineNm(kbos, cyhz);
    expect(d).toBeGreaterThan(355);
    expect(d).toBeLessThan(365);
  });

  it("returns approximately half of Earth's circumference for antipodal points", () => {
    // North pole vs south pole — half-circumference along Earth in nm
    // = π × 3440.065 ≈ 10807.4 nm
    const d = haversineNm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 });
    expect(d).toBeCloseTo(Math.PI * 3440.065, 0);
  });

  it("returns a positive distance for points on the same parallel but different longitudes", () => {
    // 1° of longitude at the equator ≈ 60 nm
    const d = haversineNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d).toBeGreaterThan(59);
    expect(d).toBeLessThan(61);
  });

  it("treats longitude wrap-around correctly across the date line", () => {
    // 179.5°E to -179.5°E = 1° of longitude → ~60 nm at the equator
    const d = haversineNm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 });
    expect(d).toBeGreaterThan(59);
    expect(d).toBeLessThan(61);
  });
});
