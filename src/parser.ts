/** Extract product pricing data from a DOM Document. Port of pricemon parser.py.
 *
 * Priority: JSON-LD -> meta tags -> microdata -> visible-text fallback.
 * IMPORTANT: never mutates the document (content scripts run on live pages);
 * visible text comes from a detached clone with script/style removed.
 */
import { normalizeAvailability, parsePrice } from "./normalizer";
import { scanPromos, scanSignals, type SignalHits } from "./signals";

const NUM = "(?:\\d{1,3}(?:[.,\\s ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
export const PRICE_TEXT_RE = new RegExp(
  `(?:US\\$|CA\\$|A\\$|R\\$|[$€£¥₹])\\s*${NUM}` +
    `|\\b(?:USD|EUR|GBP|CAD|AUD)\\b\\s*${NUM}` +
    `|${NUM}\\s*(?:€|£|\\b(?:USD|EUR|GBP)\\b|\\bkr\\b)`,
  "i",
);

const WAS_CLASS_RE = /was|old|original|compare|strike|list|regular|msrp/i;
const PRICE_CONTAINER_SEL = '[class*="price" i], [id*="price" i], [data-price]';
const WAS_SEL =
  'del, s, strike, [class*="was" i], [class*="strike" i], [class*="compare" i], ' +
  '[class*="original" i], [class*="old-price" i], [class*="list-price" i], [class*="msrp" i]';

const FREE_SHIP_RE = /free\s+(?:standard\s+)?(?:shipping|delivery)|(?:shipping|delivery)\s*:?\s*free/i;
const SHIP_COST_RE = /(?:shipping|delivery)\s*:?\s*\+?\s*((?:US\$|CA\$|A\$|[$€£¥₹])\s*[\d.,]+)/i;

const AVAIL_TEXT_PATTERNS: Array<[string, RegExp]> = [
  ["out_of_stock", /out\s+of\s+stock|sold\s*out|currently\s+unavailable/i],
  ["limited", /only\s+\d+\s+left|low\s+stock|few\s+left|limited\s+availability/i],
  ["preorder", /\bpre-?order\b/i],
  ["in_stock", /\bin\s+stock\b|add\s+to\s+(?:cart|basket|bag)/i],
];

export interface ParsedProduct {
  title: string | null;
  rawPrice: string | null;
  price: number | null;
  currency: string | null;
  priceOriginal: number | null;
  salePrice: number | null;
  availability: string;
  shippingCost: number | null;
  shippingRaw: string | null;
  promos: string[];
  signals: SignalHits;
  snippet: string | null;
  method: "jsonld" | "meta" | "microdata" | "text" | "none";
}

function emptyResult(): ParsedProduct {
  return {
    title: null, rawPrice: null, price: null, currency: null,
    priceOriginal: null, salePrice: null, availability: "unknown",
    shippingCost: null, shippingRaw: null, promos: [], signals: {},
    snippet: null, method: "none",
  };
}

export function parseProduct(doc: Document): ParsedProduct {
  const result = emptyResult();
  result.title = extractTitle(doc);

  let method: ParsedProduct["method"] = "none";
  if (extractJsonLd(doc, result)) method = "jsonld";
  else if (extractMeta(doc, result)) method = "meta";
  else if (extractMicrodata(doc, result)) method = "microdata";

  const visible = visibleText(doc);

  if (result.price === null && extractFromText(doc, visible, result)) method = "text";
  if (result.availability === "unknown") inferAvailabilityFromText(visible, result);
  extractWasPrice(doc, result);
  extractShipping(visible, result);
  result.promos = scanPromos(visible);
  result.signals = scanSignals(visible);
  addDomCountdown(doc, result);
  if (result.snippet === null && result.price !== null) {
    result.snippet = snippetAround(visible, result.rawPrice ?? "");
  }
  if (result.price !== null && result.priceOriginal !== null && result.price < result.priceOriginal) {
    result.salePrice = result.price;
  }
  result.method = method;
  return result;
}

/** Cheap pre-check so content scripts skip full parsing on non-product pages. */
export function looksLikeProductPage(doc: Document): boolean {
  if (doc.querySelector('script[type*="ld+json" i]')) return true;
  if (doc.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]')) return true;
  if (doc.querySelector('[itemprop="price"]')) return true;
  return doc.querySelector(PRICE_CONTAINER_SEL) !== null;
}

// -- helpers -------------------------------------------------------------------

function extractTitle(doc: Document): string | null {
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
  if (og) return og;
  const title = doc.title?.trim();
  if (title) return title;
  const h1 = doc.querySelector("h1")?.textContent?.trim();
  return h1 || null;
}

function visibleText(doc: Document): string {
  const clone = (doc.body ?? doc.documentElement)?.cloneNode(true) as HTMLElement | null;
  if (!clone) return "";
  clone.querySelectorAll("script, style, noscript, template, svg").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

// -- JSON-LD --------------------------------------------------------------------

function* iterNodes(data: unknown): Generator<Record<string, unknown>> {
  const stack: unknown[] = [data];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      yield node as Record<string, unknown>;
      stack.push(...Object.values(node));
    }
  }
}

function isProduct(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some(
    (x) => typeof x === "string" && ["product", "productmodel", "individualproduct"].includes(x.toLowerCase()),
  );
}

type Offer = Record<string, unknown>;

function firstOffer(offers: unknown): Offer | null {
  if (offers === null || offers === undefined) return null;
  if (Array.isArray(offers)) {
    for (const o of offers) {
      const got = firstOffer(o);
      if (got) return got;
    }
    return null;
  }
  if (typeof offers === "object") {
    const obj = offers as Offer;
    if (obj.price !== undefined && obj.price !== null) return obj;
    if (obj.lowPrice !== undefined && obj.lowPrice !== null) return obj;
    const spec = obj.priceSpecification;
    const specs = Array.isArray(spec) ? spec : [spec];
    for (const s of specs) {
      if (s && typeof s === "object" && (s as Offer).price !== undefined && (s as Offer).price !== null) {
        return { ...obj, price: (s as Offer).price, priceCurrency: obj.priceCurrency ?? (s as Offer).priceCurrency };
      }
    }
    return firstOffer(obj.offers);
  }
  return null;
}

function extractJsonLd(doc: Document, result: ParsedProduct): boolean {
  for (const tag of doc.querySelectorAll('script[type*="ld+json" i]')) {
    const payload = tag.textContent?.trim();
    if (!payload) continue;
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    for (const node of iterNodes(data)) {
      if (!isProduct(node)) continue;
      const offer = firstOffer(node.offers);
      if (!offer) continue;
      const raw = offer.price ?? offer.lowPrice;
      const hint = typeof offer.priceCurrency === "string" ? offer.priceCurrency : null;
      const { value, currency } = parsePrice(raw as string | number, hint);
      if (value === null) continue;
      result.rawPrice = String(raw);
      result.price = value;
      result.currency = currency ? currency.toUpperCase() : null;
      const avail = offer.availability ?? node.availability;
      if (typeof avail === "string") result.availability = normalizeAvailability(avail);
      return true;
    }
  }
  return false;
}

// -- meta / microdata -------------------------------------------------------------

function metaContent(doc: Document, selector: string): string | null {
  const content = doc.querySelector(selector)?.getAttribute("content")?.trim();
  return content || null;
}

function extractMeta(doc: Document, result: ParsedProduct): boolean {
  const raw =
    metaContent(doc, 'meta[property="product:price:amount"]') ??
    metaContent(doc, 'meta[property="og:price:amount"]') ??
    metaContent(doc, 'meta[itemprop="price"]') ??
    metaContent(doc, 'meta[name="price"]');
  if (!raw) return false;
  const cur = (
    metaContent(doc, 'meta[property="product:price:currency"]') ??
    metaContent(doc, 'meta[property="og:price:currency"]') ??
    metaContent(doc, 'meta[itemprop="priceCurrency"]')
  )?.toUpperCase() ?? null;
  const { value, currency } = parsePrice(raw, cur);
  if (value === null) return false;
  result.rawPrice = raw;
  result.price = value;
  result.currency = cur ?? currency;
  const avail =
    metaContent(doc, 'meta[property="og:availability"]') ??
    metaContent(doc, 'meta[property="product:availability"]') ??
    metaContent(doc, 'meta[name="availability"]');
  if (avail) result.availability = normalizeAvailability(avail);
  return true;
}

function extractMicrodata(doc: Document, result: ParsedProduct): boolean {
  const el = doc.querySelector('[itemprop="price"]:not(meta)');
  if (!el) return false;
  const raw = el.getAttribute("content") || el.textContent?.replace(/\s+/g, " ").trim() || "";
  const curEl = doc.querySelector('[itemprop="priceCurrency"]');
  const cur = (curEl?.getAttribute("content") || curEl?.textContent || "").trim().toUpperCase() || null;
  const { value, currency } = parsePrice(raw, cur);
  if (value === null) return false;
  result.rawPrice = raw.trim();
  result.price = value;
  result.currency = cur ?? currency;
  const availEl = doc.querySelector('[itemprop="availability"]');
  if (availEl) {
    result.availability = normalizeAvailability(
      availEl.getAttribute("href") || availEl.getAttribute("content") || availEl.textContent,
    );
  }
  return true;
}

// -- text fallback -----------------------------------------------------------------

function extractFromText(doc: Document, visible: string, result: ParsedProduct): boolean {
  let raw: string | null = null;
  for (const el of doc.querySelectorAll(PRICE_CONTAINER_SEL)) {
    if (el.closest("del, s, strike")) continue;
    const ident = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
    if (WAS_CLASS_RE.test(ident)) continue;
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const m = PRICE_TEXT_RE.exec(text);
    if (m) {
      raw = m[0];
      break;
    }
  }
  if (raw === null) {
    const m = PRICE_TEXT_RE.exec(visible);
    raw = m ? m[0] : null;
  }
  if (raw === null) return false;
  const { value, currency } = parsePrice(raw);
  if (value === null) return false;
  result.rawPrice = raw.trim();
  result.price = value;
  result.currency = result.currency ?? currency;
  return true;
}

function inferAvailabilityFromText(visible: string, result: ParsedProduct): void {
  for (const [label, pattern] of AVAIL_TEXT_PATTERNS) {
    if (pattern.test(visible)) {
      result.availability = label;
      return;
    }
  }
}

function extractWasPrice(doc: Document, result: ParsedProduct): void {
  if (result.price === null) return;
  for (const el of doc.querySelectorAll(WAS_SEL)) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const m = PRICE_TEXT_RE.exec(text);
    if (!m) continue;
    const { value } = parsePrice(m[0], result.currency);
    if (value !== null && value > result.price) {
      result.priceOriginal = value;
      return;
    }
  }
}

function extractShipping(visible: string, result: ParsedProduct): void {
  if (FREE_SHIP_RE.test(visible)) {
    result.shippingCost = 0;
    result.shippingRaw = "free shipping";
    return;
  }
  const m = SHIP_COST_RE.exec(visible);
  if (m) {
    const { value } = parsePrice(m[1], result.currency);
    if (value !== null) {
      result.shippingCost = value;
      result.shippingRaw = m[0].trim();
    }
  }
}

function addDomCountdown(doc: Document, result: ParsedProduct): void {
  const el = doc.querySelector('[class*="countdown" i], [data-countdown], [class*="timer" i]');
  if (!el) return;
  const text = el.textContent?.replace(/\s+/g, " ").trim().slice(0, 60) || "countdown element present";
  const hits = (result.signals.countdown ??= []);
  if (!hits.includes(text)) hits.push(text);
}

function snippetAround(visible: string, needle: string, width = 70): string | null {
  let idx = needle ? visible.indexOf(needle) : -1;
  let found = needle;
  if (idx < 0) {
    const m = PRICE_TEXT_RE.exec(visible);
    if (!m) return null;
    idx = m.index;
    found = m[0];
  }
  const lo = Math.max(0, idx - width);
  const hi = Math.min(visible.length, idx + found.length + width);
  return (lo > 0 ? "…" : "") + visible.slice(lo, hi).trim() + (hi < visible.length ? "…" : "");
}
