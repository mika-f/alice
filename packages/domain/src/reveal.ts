import type { NameState } from "./name.js";

/** Spec §27.7: reveal reminders only apply while a name is actually in its reveal window. */
export const REVEAL_CATEGORIES = ["none", "pending", "urgent"] as const;

export type RevealCategory = (typeof REVEAL_CATEGORIES)[number];

export interface RevealThresholds {
  blocksRemaining: number;
}

/** ~6 hours at Handshake's 10-minute target block time — missing reveal forfeits the entire lockup. */
export const DEFAULT_REVEAL_THRESHOLDS: RevealThresholds = { blocksRemaining: 36 };

export interface RevealableName {
  state: NameState;
  blocksRemaining: number;
}

/**
 * Only tells us a reveal deadline exists for this name — not whether *this* wallet has a bid to
 * reveal (callers filter that separately from `NameDetails.bids`/`.reveals`, since that needs the
 * per-name detail call, not the bulk list this runs against).
 */
export function classifyReveal(
  name: RevealableName,
  thresholds: RevealThresholds = DEFAULT_REVEAL_THRESHOLDS,
): RevealCategory {
  if (name.state !== "revealing") return "none";
  return name.blocksRemaining < thresholds.blocksRemaining ? "urgent" : "pending";
}
