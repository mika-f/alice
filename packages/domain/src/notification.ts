/** Spec §20.1. */
export const NOTIFICATION_TYPES = [
  "renewal-approaching",
  "expiration-approaching",
  "finalize-available",
  "transfer-state-changed",
  "node-disconnected",
  "wallet-disconnected",
  "node-sync-stalled",
  "hsd-version-unsupported",
  "tx-confirmed",
  "tx-failed",
  "wallet-sync-delayed",
  "reveal-deadline-approaching",
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
