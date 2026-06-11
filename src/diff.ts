/** Change detection + dynamic-pricing confidence. Port of pricemon diff.py.
 *
 * Confidence model (heuristic, 0..1):
 *   +0.25 price went UP (sales lower prices; silent increases = classic tell)
 *   +0.20 urgency/popularity signals on the page
 *   +0.10 signals appeared at the same time as the change
 *   +0.25 price oscillating within the recent window
 *   +0.10 price dropped with no promo label (silent markdown)
 *   -0.35 price dropped AND promo label present (normal sale)
 *   +0.05 small move (<10%) typical of algorithmic nudging
 *   +0.10 price rose under low-stock pressure
 * >=0.60 dynamic_pricing_suspected; <=0.30 with promo likely_sale_update;
 * <=0.30 without normal_update; else unclear. Heuristics, not proof.
 */
import type { SignalHits } from "./signals";

export const URGENCY_CATEGORIES = ["low_stock", "social_proof", "trending", "urgency", "countdown"];

export interface Thresholds {
  minAbsChange: number;
  minPctChange: number;
  alertCooldownMinutes: number;
  oscillationWindow: number;
  oscillationMinFlips: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minAbsChange: 0.01,
  minPctChange: 0.5,
  alertCooldownMinutes: 60,
  oscillationWindow: 6,
  oscillationMinFlips: 3,
};

export interface SnapshotLike {
  price: number | null;
  availability: string;
  promos: string[];
  signals: SignalHits;
}

export interface Change {
  changeType: "price_increase" | "price_decrease" | "availability_change" | "oscillation";
  oldValue: string | null;
  newValue: string | null;
  changeAmount: number | null;
  changePct: number | null;
  confidence: number;
  classification: string;
  reasons: string[];
}

function urgency(signals: SignalHits | undefined): Set<string> {
  const out = new Set<string>();
  if (!signals) return out;
  for (const k of Object.keys(signals)) {
    if (URGENCY_CATEGORIES.includes(k) && signals[k]?.length) out.add(k);
  }
  return out;
}

/** Direction reversals in a chronological price series (nulls skipped). */
export function countFlips(prices: Array<number | null>): number {
  const vals = prices.filter((p): p is number => p !== null && p !== undefined);
  const dirs: number[] = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1]) dirs.push(vals[i] > vals[i - 1] ? 1 : -1);
  }
  let flips = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++;
  return flips;
}

export interface ScoreInputs {
  direction: "up" | "down";
  pctChange: number;
  promosNew: boolean;
  signalsNew: Set<string>;
  signalsPrev: Set<string>;
  oscillation: boolean;
}

export function scoreDynamicPricing(s: ScoreInputs): { score: number; classification: string; reasons: string[] } {
  let score = 0.15;
  const reasons: string[] = [];
  if (s.direction === "up") {
    score += 0.25;
    reasons.push("price increased (sales lower prices; increases suggest demand-based repricing)");
  }
  if (s.signalsNew.size) {
    score += 0.2;
    reasons.push("urgency/popularity signals present: " + [...s.signalsNew].sort().join(", "));
    const appeared = [...s.signalsNew].filter((x) => !s.signalsPrev.has(x));
    if (appeared.length) {
      score += 0.1;
      reasons.push("signals appeared alongside the change: " + appeared.sort().join(", "));
    }
  }
  if (s.direction === "down") {
    if (s.promosNew) {
      score -= 0.35;
      reasons.push("price drop with promo/sale labels (consistent with a normal sale)");
    } else {
      score += 0.1;
      reasons.push("silent markdown (no promo label on the page)");
    }
  }
  if (s.oscillation) {
    score += 0.25;
    reasons.push("price oscillating across recent checks");
  }
  if (Math.abs(s.pctChange) > 0 && Math.abs(s.pctChange) < 10) {
    score += 0.05;
    reasons.push(`small move (${s.pctChange >= 0 ? "+" : ""}${s.pctChange.toFixed(1)}%) typical of algorithmic nudging`);
  }
  if (s.direction === "up" && s.signalsNew.has("low_stock")) {
    score += 0.1;
    reasons.push("price rose while page shows low-stock pressure");
  }
  score = Math.max(0, Math.min(1, score));
  let classification: string;
  if (score >= 0.6) classification = "dynamic_pricing_suspected";
  else if (score <= 0.3) {
    classification = s.direction === "down" && s.promosNew ? "likely_sale_update" : "normal_update";
  } else classification = "unclear";
  return { score, classification, reasons };
}

/**
 * Compare the newest snapshot against history.
 * prevSnapshots: MOST RECENT FIRST. newSnap: the snapshot just taken.
 */
export function detectChanges(
  prevSnapshots: SnapshotLike[],
  newSnap: SnapshotLike,
  t: Thresholds = DEFAULT_THRESHOLDS,
): Change[] {
  if (!prevSnapshots.length) return [];
  const prev = prevSnapshots[0];
  const changes: Change[] = [];

  const oldPrice = prev.price;
  const newPrice = newSnap.price;

  const windowPrev = prevSnapshots.slice(0, Math.max(0, t.oscillationWindow - 1));
  const series = [...windowPrev].reverse().map((s) => s.price);
  series.push(newPrice);
  const flips = countFlips(series);
  const oscillating = flips >= t.oscillationMinFlips;

  if (oldPrice !== null && newPrice !== null && oldPrice !== newPrice) {
    const delta = Math.round((newPrice - oldPrice) * 100) / 100;
    const pct = oldPrice ? Math.round((delta / oldPrice) * 10000) / 100 : 0;
    if (Math.abs(delta) >= t.minAbsChange && Math.abs(pct) >= t.minPctChange) {
      const { score, classification, reasons } = scoreDynamicPricing({
        direction: delta > 0 ? "up" : "down",
        pctChange: pct,
        promosNew: newSnap.promos.length > 0,
        signalsNew: urgency(newSnap.signals),
        signalsPrev: urgency(prev.signals),
        oscillation: oscillating,
      });
      changes.push({
        changeType: delta > 0 ? "price_increase" : "price_decrease",
        oldValue: oldPrice.toFixed(2),
        newValue: newPrice.toFixed(2),
        changeAmount: delta,
        changePct: pct,
        confidence: Math.round(score * 100) / 100,
        classification,
        reasons,
      });
      if (oscillating) {
        changes.push({
          changeType: "oscillation",
          oldValue: null,
          newValue: `${flips} direction flips in last ${series.length} checks`,
          changeAmount: null,
          changePct: null,
          confidence: Math.min(1, 0.6 + 0.1 * (flips - t.oscillationMinFlips)),
          classification: "dynamic_pricing_suspected",
          reasons: [`price direction flipped ${flips}x within the window`],
        });
      }
    }
  }

  const oldAv = prev.availability || "unknown";
  const newAv = newSnap.availability || "unknown";
  if (oldAv !== newAv && oldAv !== "unknown" && newAv !== "unknown") {
    changes.push({
      changeType: "availability_change",
      oldValue: oldAv,
      newValue: newAv,
      changeAmount: null,
      changePct: null,
      confidence: newAv === "limited" ? 0.3 : 0.1,
      classification: "availability_update",
      reasons: [`availability changed ${oldAv} -> ${newAv}`],
    });
  }

  return changes;
}

/** Min-time-between-alerts gate (timestamps in epoch ms). */
export function cooldownPassed(lastAlertMs: number | null, nowMs: number, cooldownMinutes: number): boolean {
  if (lastAlertMs === null || lastAlertMs === undefined) return true;
  return nowMs - lastAlertMs >= cooldownMinutes * 60_000;
}
