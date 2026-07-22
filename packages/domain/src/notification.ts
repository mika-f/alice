/**
 * Spec §20.1. Two of the spec's listed conditions are deliberately not covered yet:
 * tx-confirmed/tx-failed would need broadcast-tracking infrastructure shared across every write
 * path (send/update/renew/transfer/finalize/revoke) and the Transaction History page already
 * surfaces confirmation status directly; wallet-sync-delayed has no signal to derive it from —
 * hsd's wallet HTTP API doesn't expose a rescan-progress indicator (see HsdV8Adapter.getWalletStatus).
 * Both are reasonable Phase 5 additions alongside the other deferred operational-hardening items.
 */
export const NOTIFICATION_TYPES = [
  "renewal-approaching",
  "expiration-approaching",
  "finalize-available",
  "transfer-state-changed",
  "node-disconnected",
  "wallet-disconnected",
  "node-sync-stalled",
  "hsd-version-unsupported",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: number;
  type: NotificationType;
  name: string | null;
  message: string;
  createdAt: number;
  readAt: number | null;
}
