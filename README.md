# moot-engine

The open-source detection engine behind [Moot](../..) — a browser extension
that answers "is this sale real?". This package is the entire brain:
product-page price extraction, pressure-tactic signal scanning, and
dynamic-pricing confidence scoring. **MIT licensed. Runs entirely on-device.
No network calls anywhere in this code.**

We open-sourced the engine because trust in shopping extensions should be
verifiable, not promised. Audit it, fork it, break it — and if you break it,
file an issue.

## What's inside

| Module | Responsibility |
|---|---|
| `src/parser.ts` | Extract product data from a DOM `Document`: JSON-LD (`Product`/`Offer`/`AggregateOffer`, `@graph`, `priceSpecification`) → OpenGraph/meta → microdata → visible-text fallback. Struck-through "was" prices, shipping, snippet capture. Never mutates the page. |
| `src/normalizer.ts` | Price-string normalization ("1.299,00 €" → 1299.00 EUR), currency detection, availability enums. |
| `src/signals.ts` | Urgency/popularity/promo pattern scanning: low stock, countdown timers (context-checked), "N people viewing", trending badges, back-in-stock. Every match keeps the snippet that triggered it. |
| `src/diff.ts` | Change detection between snapshots + the confidence model below. |

## The confidence model

Each price change scores 0–1 for "looks algorithmic vs. looks like a
merchandised sale", additively:

| Evidence | Weight |
|---|---|
| Price went up | +0.25 |
| Urgency/popularity signals present | +0.20 |
| Signals appeared alongside the change | +0.10 |
| Price oscillating (≥3 direction flips in window) | +0.25 |
| Silent markdown (drop, no promo label) | +0.10 |
| Drop with promo/sale label | −0.35 |
| Small move (<10%) | +0.05 |
| Price rose under low-stock pressure | +0.10 |

≥0.60 → `dynamic_pricing_suspected` · ≤0.30 with promo → `likely_sale_update`
· ≤0.30 without → `normal_update` · else `unclear`.

These are **heuristics, not proof** — every score returns its plain-English
reasons so flags stay auditable. Real clearances and real low stock exist.

## Usage

```ts
import { parseProduct, looksLikeProductPage } from "./src/parser";
import { detectChanges, DEFAULT_THRESHOLDS } from "./src/diff";

if (looksLikeProductPage(document)) {
  const snapshot = parseProduct(document);
  const changes = detectChanges(previousSnapshots, snapshot, DEFAULT_THRESHOLDS);
  // changes[i].confidence, .classification, .reasons
}
```

Works in any environment with a DOM `Document` (browser, jsdom, an MV3
offscreen document). Zero runtime dependencies.

## Tests

```bash
npm install
npm test        # 49 tests
```

The suite runs against real-world-shaped HTML fixtures and mirrors the
original Python implementation's test suite 1:1 — the engine began life as a
Python price monitor and the TS port is parity-tested against it.

## Contributing — signal packs wanted

The highest-value contribution: **localized signal patterns.** Current
urgency/promo regexes are English-first. If you shop in German, French,
Spanish, Japanese — add patterns to `src/signals.ts` with a fixture page and
a test. Pattern guidelines:

- Keep matches narrow; false positives erode every flag's credibility.
- Every pattern category stores its matched snippet — your pattern should
  produce human-readable evidence.
- Countdown-style patterns need a context word check (see `_COUNTDOWN_CONTEXT`)
  to avoid flagging video timestamps.

Also welcome: retailer-specific extraction fixes (as fixtures + tests, not
site-specific hacks), additional schema.org coverage, and adversarial
fixtures that fool the parser.

## Relationship to the Moot extension

The extension wraps this engine with browser plumbing (storage, alerts,
popup UI) and a paid tier for convenience features. The engine itself is and
stays MIT — the detection logic should be a public good.
