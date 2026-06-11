import { describe, expect, it } from "vitest";
import { detectCurrency, normalizeAvailability, parsePrice } from "../src/normalizer";

describe("parsePrice formats (parity with pricemon test_normalizer.py)", () => {
  const cases: Array<[string, number, string | null]> = [
    ["$1,299.99", 1299.99, "USD"],
    ["1.299,00 €", 1299.0, "EUR"],
    ["49,90", 49.9, null],
    ["USD 49", 49.0, "USD"],
    ["¥1,500", 1500.0, "JPY"],
    ["£12.50", 12.5, "GBP"],
    ["12.5", 12.5, null],
    ["1,299", 1299.0, null],
    ["1,299,000", 1299000.0, null],
    ["CA$ 99.99", 99.99, "CAD"],
    ["$ 1 299", 1299.0, "USD"],
    ["129.99", 129.99, null],
  ];
  it.each(cases)("parses %s", (raw, expectedValue, expectedCurrency) => {
    const { value, currency } = parsePrice(raw);
    expect(value).toBeCloseTo(expectedValue, 2);
    expect(currency).toBe(expectedCurrency);
  });
});

it("numeric passthrough", () => {
  expect(parsePrice(1299.989).value).toBe(1299.99);
  expect(parsePrice(50).value).toBe(50.0);
});

it("garbage input", () => {
  expect(parsePrice(null)).toEqual({ value: null, currency: null });
  expect(parsePrice("")).toEqual({ value: null, currency: null });
  expect(parsePrice("Call for price")).toEqual({ value: null, currency: null });
});

it("currency hint wins", () => {
  const { value, currency } = parsePrice("1500", "JPY");
  expect(value).toBe(1500.0);
  expect(currency).toBe("JPY");
});

it("symbol priority: CA$ beats $", () => {
  expect(detectCurrency("CA$10")).toBe("CAD");
  expect(detectCurrency("$10")).toBe("USD");
});

describe("normalizeAvailability", () => {
  const cases: Array<[string | null, string]> = [
    ["https://schema.org/InStock", "in_stock"],
    ["http://schema.org/OutOfStock", "out_of_stock"],
    ["https://schema.org/LimitedAvailability", "limited"],
    ["https://schema.org/PreOrder", "preorder"],
    ["https://schema.org/Discontinued", "discontinued"],
    ["In Stock", "in_stock"],
    ["Sold out", "out_of_stock"],
    ["Currently unavailable.", "out_of_stock"],
    ["low stock", "limited"],
    ["", "unknown"],
    [null, "unknown"],
    ["weird value", "unknown"],
  ];
  it.each(cases)("maps %s -> %s", (raw, expected) => {
    expect(normalizeAvailability(raw)).toBe(expected);
  });
});
