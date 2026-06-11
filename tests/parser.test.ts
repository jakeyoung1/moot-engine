import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeProductPage, parseProduct } from "../src/parser";

function loadDoc(name: string): Document {
  const html = readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf-8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("parser parity with pricemon test_parser.py", () => {
  it("JSON-LD product", () => {
    const p = parseProduct(loadDoc("jsonld_product.html"));
    expect(p.method).toBe("jsonld");
    expect(p.price).toBe(1299.0);
    expect(p.currency).toBe("USD");
    expect(p.availability).toBe("in_stock");
    expect(p.title).toBe("UltraWidget 9000");
    expect(p.priceOriginal).toBe(1499.0);
    expect(p.salePrice).toBe(1299.0);
    expect(p.promos.some((s) => s.toLowerCase().includes("off"))).toBe(true);
    expect(p.signals.trending).toBeDefined();
    expect(p.snippet).not.toBeNull();
  });

  it("@graph + AggregateOffer", () => {
    const p = parseProduct(loadDoc("aggregate_offer.html"));
    expect(p.method).toBe("jsonld");
    expect(p.price).toBe(89.95);
    expect(p.currency).toBe("EUR");
    expect(p.availability).toBe("limited");
  });

  it("meta tags", () => {
    const p = parseProduct(loadDoc("meta_product.html"));
    expect(p.method).toBe("meta");
    expect(p.price).toBe(49.9);
    expect(p.currency).toBe("EUR");
    expect(p.availability).toBe("in_stock");
    expect(p.title).toBe("Kaffeemaschine Pro");
  });

  it("text fallback with signals", () => {
    const p = parseProduct(loadDoc("text_product.html"));
    expect(p.method).toBe("text");
    expect(p.price).toBe(89.99);
    expect(p.currency).toBe("USD");
    expect(p.priceOriginal).toBe(119.99);
    expect(p.salePrice).toBe(89.99);
    expect(p.availability).toBe("limited");
    expect(p.shippingCost).toBe(4.99);
    expect(p.signals.low_stock).toBeDefined();
    expect(p.signals.social_proof).toBeDefined();
    expect(p.signals.countdown).toBeDefined();
    expect(p.signals.urgency).toBeDefined();
    expect(p.promos.length).toBeGreaterThan(0);
    expect(p.snippet ?? "").toContain("$89.99");
  });

  it("strikethrough never picked as current price", () => {
    const p = parseProduct(loadDoc("text_product.html"));
    expect(p.price).toBe(89.99);
  });

  it("empty page", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body><p>Nothing here</p></body></html>", "text/html");
    const p = parseProduct(doc);
    expect(p.price).toBeNull();
    expect(p.method).toBe("none");
    expect(p.availability).toBe("unknown");
    expect(looksLikeProductPage(doc)).toBe(false);
  });

  it("malformed JSON-LD falls through to text", () => {
    const doc = new DOMParser().parseFromString(
      `<html><head><title>X</title>
       <script type="application/ld+json">{not json at all</script>
       </head><body><span class="price">$10.00</span></body></html>`, "text/html");
    const p = parseProduct(doc);
    expect(p.method).toBe("text");
    expect(p.price).toBe(10.0);
  });

  it("looksLikeProductPage cheap check", () => {
    expect(looksLikeProductPage(loadDoc("jsonld_product.html"))).toBe(true);
    expect(looksLikeProductPage(loadDoc("text_product.html"))).toBe(true);
  });

  it("parsing does not mutate the live document", () => {
    const doc = loadDoc("jsonld_product.html");
    const scriptCountBefore = doc.querySelectorAll("script").length;
    parseProduct(doc);
    expect(doc.querySelectorAll("script").length).toBe(scriptCountBefore);
  });
});
