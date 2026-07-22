export const COVENANT_TYPES = [
  "NONE",
  "CLAIM",
  "OPEN",
  "BID",
  "REVEAL",
  "REDEEM",
  "REGISTER",
  "UPDATE",
  "RENEW",
  "TRANSFER",
  "FINALIZE",
  "REVOKE",
] as const;

export type CovenantType = (typeof COVENANT_TYPES)[number];

const COVENANT_LABELS: Record<CovenantType, string> = {
  NONE: "Plain transfer",
  CLAIM: "Name claim",
  OPEN: "Auction opened",
  BID: "Bid placed",
  REVEAL: "Bid revealed",
  REDEEM: "Bid redeemed",
  REGISTER: "Name registered",
  UPDATE: "DNS record updated",
  RENEW: "Name renewed",
  TRANSFER: "Transfer started",
  FINALIZE: "Transfer finalized",
  REVOKE: "Name revoked",
};

export function describeCovenant(type: CovenantType): string {
  return COVENANT_LABELS[type];
}
