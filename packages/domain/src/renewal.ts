import { estimateDaysRemaining } from "./blocks.js";
import type { NameState, TransferState } from "./name.js";

/** Spec §17.1's five categories collapse to four: "renewable" is implicit (not-renewable's negation). */
export const RENEWAL_CATEGORIES = [
  "not-renewable",
  "not-needed",
  "recommended",
  "imminent",
] as const;

export type RenewalCategory = (typeof RENEWAL_CATEGORIES)[number];

/** Spec §17.4: any one of these being crossed triggers "recommended". */
export interface RenewalThresholds {
  blocksRemaining: number;
  daysRemaining: number;
  /** 0-1: fraction of the renewal window (expirationHeight - renewalHeight) remaining. */
  expirationRatio: number;
}

export const DEFAULT_RENEWAL_THRESHOLDS: RenewalThresholds = {
  blocksRemaining: 4320, // ~30 days at Handshake's 10-minute target block time
  daysRemaining: 30,
  expirationRatio: 0.1,
};

/** "imminent" isn't separately configurable — it's a tighter cut of the same thresholds (spec §17.1's "Expiration 接近"). */
const IMMINENT_FACTOR = 0.2;

export interface RenewableName {
  state: NameState;
  transferState: TransferState;
  blocksRemaining: number;
  renewalHeight: number;
  expirationHeight: number;
}

export function classifyRenewal(
  name: RenewableName,
  thresholds: RenewalThresholds = DEFAULT_RENEWAL_THRESHOLDS,
): RenewalCategory {
  if (name.state !== "owned" || name.transferState !== "none") return "not-renewable";

  const totalWindow = name.expirationHeight - name.renewalHeight;
  const ratio = totalWindow > 0 ? name.blocksRemaining / totalWindow : 1;
  const days = estimateDaysRemaining(name.blocksRemaining);

  const meetsAny = (factor: number): boolean =>
    name.blocksRemaining < thresholds.blocksRemaining * factor ||
    days < thresholds.daysRemaining * factor ||
    ratio < thresholds.expirationRatio * factor;

  if (meetsAny(IMMINENT_FACTOR)) return "imminent";
  if (meetsAny(1)) return "recommended";
  return "not-needed";
}

export function isRenewable(name: RenewableName): boolean {
  return classifyRenewal(name) !== "not-renewable";
}
