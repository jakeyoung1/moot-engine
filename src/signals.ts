/** Urgency / popularity / promo signal scanning. Port of pricemon signals.py.
 * Every match is recorded with the snippet that triggered it so flags stay auditable. */

export const SIGNAL_PATTERNS: Record<string, string[]> = {
  low_stock: [
    "only\\s+\\d+\\s+left", "\\b\\d+\\s+left\\s+in\\s+stock", "low\\s+stock",
    "few\\s+(?:items?\\s+)?(?:left|remaining)", "\\b\\d+\\s+remaining\\b",
    "almost\\s+(?:gone|sold\\s*out)", "selling\\s+(?:fast|quickly)",
  ],
  trending: [
    "\\btrending\\b", "best\\s*seller", "popular\\s+(?:right\\s+)?now",
    "\\bhot\\s+(?:item|deal|right\\s+now)\\b", "customers?'?\\s+(?:choice|favorite)",
    "most\\s+(?:wished|popular)",
  ],
  social_proof: [
    "\\d+\\s*\\+?\\s*(?:people|shoppers|others|customers)\\s+(?:are\\s+)?(?:viewing|looking|watching)",
    "\\d+\\s*\\+?\\s*(?:people|shoppers|customers)\\s+(?:bought|purchased|ordered)",
    "bought\\s+\\d+\\s*\\+?\\s*times", "in\\s+\\d+\\s+(?:people'?s\\s+)?carts?",
    "\\b\\d+\\s*\\+?\\s*(?:sold|bought)\\s+(?:in|over|this|today)",
  ],
  urgency: [
    "limited\\s+time", "ends\\s+(?:soon|today|tonight|in\\b)", "\\bhurry\\b",
    "last\\s+chance", "flash\\s+sale", "while\\s+(?:stocks?|supplies)\\s+last",
    "deal\\s+of\\s+the\\s+day", "don'?t\\s+miss\\s+out", "order\\s+soon",
  ],
  countdown: [
    "\\b\\d{1,2}:\\d{2}:\\d{2}\\b",
    "\\b\\d+\\s*(?:hrs?|hours?)\\s+\\d+\\s*(?:mins?|minutes?)\\b",
  ],
  back_in_stock: [
    "back\\s+in\\s+stock", "\\brestocked\\b", "notify\\s+me\\s+when",
    "email\\s+(?:me\\s+)?when\\s+available",
  ],
};

const COUNTDOWN_CONTEXT = /end|sale|deal|offer|expire|left|hurry|remaining/i;
const CONTEXT_CHARS = 60;

export const PROMO_PATTERNS = [
  "\\d+\\s*%\\s*off", "save\\s+(?:up\\s+to\\s+)?[$€£]?\\s*[\\d.,]+", "\\bsale\\b",
  "\\bclearance\\b", "\\bdeal\\b", "\\bcoupon\\b", "promo\\s*code", "\\bdiscount",
  "black\\s+friday", "cyber\\s+monday", "price\\s+drop", "was\\s+[$€£]\\s*[\\d.,]+",
  "list\\s+price", "\\bmarkdown\\b",
];

export type SignalHits = Record<string, string[]>;

export function scanSignals(text: string): SignalHits {
  const found: SignalHits = {};
  if (!text) return found;
  for (const [category, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    const hits: string[] = [];
    for (const pattern of patterns) {
      const re = new RegExp(pattern, "gi");
      for (const m of text.matchAll(re)) {
        if (category === "countdown") {
          const lo = Math.max(0, (m.index ?? 0) - CONTEXT_CHARS);
          const window = text.slice(lo, (m.index ?? 0) + m[0].length + CONTEXT_CHARS);
          if (!COUNTDOWN_CONTEXT.test(window)) continue;
        }
        hits.push(m[0].trim());
      }
    }
    if (hits.length) {
      found[category] = [...new Set(hits)].sort().slice(0, 5);
    }
  }
  return found;
}

export function scanPromos(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const pattern of PROMO_PATTERNS) {
    const re = new RegExp(pattern, "gi");
    for (const m of text.matchAll(re)) hits.push(m[0].trim());
  }
  return [...new Set(hits)].sort().slice(0, 10);
}
