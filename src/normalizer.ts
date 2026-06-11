/** Normalize raw price strings and availability values. Port of pricemon normalizer.py. */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  "US$": "USD",
  "CA$": "CAD",
  "C$": "CAD",
  "A$": "AUD",
  "R$": "BRL",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "zł": "PLN",
};

export const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK",
  "DKK", "INR", "CNY", "MXN", "BRL", "PLN", "ZAR", "SGD", "HKD", "KRW",
];

/** Currencies without minor units: separators are always grouping. */
const ZERO_DECIMAL = new Set(["JPY", "KRW"]);

const NUMBER_RE = /\d[\d.,\s ]*\d|\d/;
const CODE_RE = new RegExp(`\\b(${CURRENCY_CODES.join("|")})\\b`, "i");
const SYMBOLS_BY_LENGTH = Object.keys(CURRENCY_SYMBOLS).sort((a, b) => b.length - a.length);

export function detectCurrency(raw: string): string | null {
  const m = CODE_RE.exec(raw);
  if (m) return m[1].toUpperCase();
  for (const sym of SYMBOLS_BY_LENGTH) {
    if (raw.includes(sym)) return CURRENCY_SYMBOLS[sym];
  }
  return null;
}

export interface ParsedPrice {
  value: number | null;
  currency: string | null;
}

/**
 * Parse a raw price into a normalized value + currency.
 * Separator rule: with both ',' and '.', the rightmost is the decimal mark;
 * with one separator, 2 trailing digits = decimal, 3 = thousands grouping.
 */
export function parsePrice(raw: unknown, currencyHint: string | null = null): ParsedPrice {
  if (raw === null || raw === undefined) return { value: null, currency: currencyHint };
  if (typeof raw === "number") {
    return { value: Math.round(raw * 100) / 100, currency: currencyHint };
  }
  const text = String(raw).trim();
  if (!text) return { value: null, currency: currencyHint };
  const currency = currencyHint ?? detectCurrency(text);
  const m = NUMBER_RE.exec(text);
  if (!m) return { value: null, currency };
  let num = m[0].replace(/[\s ]/g, "");
  const hasDot = num.includes(".");
  const hasComma = num.includes(",");
  if (hasDot && hasComma) {
    const dec = num.lastIndexOf(".") > num.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    num = num.split(thou).join("");
    num = num.replace(dec, ".");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const idx = num.lastIndexOf(sep);
    const head = num.slice(0, idx);
    const tail = num.slice(idx + 1);
    const count = num.split(sep).length - 1;
    if (count > 1 || tail.length === 3) {
      num = num.split(sep).join(""); // grouping: "1.299" / "1,299,000"
    } else {
      num = head.split(sep).join("") + "." + tail;
    }
  }
  let value = Number(num);
  if (!Number.isFinite(value)) return { value: null, currency };
  if (currency && ZERO_DECIMAL.has(currency)) value = Math.trunc(value);
  return { value: Math.round(value * 100) / 100, currency };
}

/** Checked in order; more specific states first. */
const AVAILABILITY_MAP: Array<[string, string[]]> = [
  ["out_of_stock", ["outofstock", "out of stock", "sold out", "soldout",
    "currently unavailable", "unavailable", "notavailable"]],
  ["discontinued", ["discontinued"]],
  ["preorder", ["preorder", "pre-order", "presale", "pre-sale"]],
  ["backorder", ["backorder", "back-order", "back order"]],
  ["limited", ["limitedavailability", "limited availability", "low stock", "few left"]],
  ["in_stock", ["instock", "in stock", "available", "add to cart", "add to basket", "ships"]],
];

export function normalizeAvailability(value: string | null | undefined): string {
  if (!value) return "unknown";
  let text = String(value).trim().toLowerCase();
  if (text.includes("schema.org")) {
    text = text.slice(text.lastIndexOf("/") + 1);
  }
  for (const [label, needles] of AVAILABILITY_MAP) {
    if (needles.some((n) => text.includes(n))) return label;
  }
  return "unknown";
}
