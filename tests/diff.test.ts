import { describe, expect, it } from "vitest";
import {
  cooldownPassed,
  countFlips,
  DEFAULT_THRESHOLDS,
  detectChanges,
  type SnapshotLike,
  type Thresholds,
} from "../src/diff";

function snap(
  price: number | null = null,
  availability = "unknown",
  promos: string[] = [],
  signals: Record<string, string[]> = {},
): SnapshotLike {
  return { price, availability, promos, signals };
}

const T: Thresholds = { ...DEFAULT_THRESHOLDS, minAbsChange: 0.01, minPctChange: 0.5 };

describe("detectChanges parity with pricemon test_diff.py", () => {
  it("no previous snapshot -> no changes", () => {
    expect(detectChanges([], snap(100))).toEqual([]);
  });

  it("price increase detected", () => {
    const changes = detectChanges([snap(100.0, "in_stock")], snap(108.0, "in_stock"), T);
    expect(changes).toHaveLength(1);
    const c = changes[0];
    expect(c.changeType).toBe("price_increase");
    expect(c.changeAmount).toBe(8.0);
    expect(c.changePct).toBe(8.0);
    expect(c.oldValue).toBe("100.00");
    expect(c.newValue).toBe("108.00");
  });

  it("increase with new urgency signals scores high", () => {
    const prev = [snap(100.0, "in_stock")];
    const next = snap(108.0, "in_stock", [], {
      low_stock: ["only 2 left"],
      social_proof: ["34 people are viewing"],
    });
    const c = detectChanges(prev, next, T)[0];
    expect(c.confidence).toBeGreaterThanOrEqual(0.6);
    expect(c.classification).toBe("dynamic_pricing_suspected");
  });

  it("decrease with promo label looks like a sale", () => {
    const c = detectChanges([snap(100.0)], snap(80.0, "unknown", ["50% off", "sale"]), T)[0];
    expect(c.changeType).toBe("price_decrease");
    expect(c.confidence).toBeLessThanOrEqual(0.3);
    expect(c.classification).toBe("likely_sale_update");
  });

  it("abs threshold suppresses small moves", () => {
    const t = { ...T, minAbsChange: 5.0 };
    expect(detectChanges([snap(100.0)], snap(103.0), t)).toEqual([]);
  });

  it("pct threshold suppresses small moves", () => {
    const t = { ...T, minPctChange: 5.0 };
    expect(detectChanges([snap(100.0)], snap(102.0), t)).toEqual([]);
  });

  it("availability change detected", () => {
    const changes = detectChanges([snap(100.0, "in_stock")], snap(100.0, "out_of_stock"), T);
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe("availability_change");
    expect(changes[0].oldValue).toBe("in_stock");
    expect(changes[0].newValue).toBe("out_of_stock");
  });

  it("unknown availability is not a change", () => {
    expect(detectChanges([snap(100.0, "unknown")], snap(100.0, "in_stock"), T)).toEqual([]);
  });

  it("null prices do not crash", () => {
    expect(detectChanges([snap(null)], snap(100.0), T)).toEqual([]);
    expect(detectChanges([snap(100.0)], snap(null), T)).toEqual([]);
  });

  it("oscillation flagged", () => {
    const prev = [snap(110.0), snap(100.0), snap(110.0), snap(100.0)]; // most recent first
    const changes = detectChanges(prev, snap(100.0), T);
    const types = new Set(changes.map((c) => c.changeType));
    expect(types.has("price_decrease")).toBe(true);
    expect(types.has("oscillation")).toBe(true);
    const osc = changes.find((c) => c.changeType === "oscillation")!;
    expect(osc.classification).toBe("dynamic_pricing_suspected");
    expect(osc.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

it("countFlips", () => {
  expect(countFlips([100, 110, 100, 110, 100])).toBe(3);
  expect(countFlips([100, 110, 120, 130])).toBe(0);
  expect(countFlips([100, null, 110, 100])).toBe(1);
  expect(countFlips([])).toBe(0);
});

it("cooldownPassed", () => {
  const now = Date.UTC(2026, 5, 10, 12, 0, 0);
  expect(cooldownPassed(null, now, 60)).toBe(true);
  expect(cooldownPassed(Date.UTC(2026, 5, 10, 11, 30, 0), now, 60)).toBe(false);
  expect(cooldownPassed(Date.UTC(2026, 5, 10, 10, 0, 0), now, 60)).toBe(true);
  expect(cooldownPassed(Date.UTC(2026, 5, 10, 11, 30, 0), now, 0)).toBe(true);
});
