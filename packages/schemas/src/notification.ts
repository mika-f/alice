import { z } from "zod";

/** Spec §17.4: any one of these being crossed triggers a renewal-approaching notification. */
export const renewalThresholdsRequestSchema = z.object({
  blocksRemaining: z.number().int().positive(),
  daysRemaining: z.number().positive(),
  expirationRatio: z.number().min(0).max(1),
});

export type RenewalThresholdsRequestBody = z.infer<typeof renewalThresholdsRequestSchema>;

/** Spec §27.7: reveal-deadline-approaching fires once a name's remaining reveal-window blocks drop below this. */
export const revealThresholdsRequestSchema = z.object({
  blocksRemaining: z.number().int().positive(),
});

export type RevealThresholdsRequestBody = z.infer<typeof revealThresholdsRequestSchema>;

/**
 * `url` may be submitted empty to mean "leave the existing configured value unchanged" (so
 * toggling `enabled` doesn't force retyping a webhook URL the server already has); required only
 * when the channel is being enabled for the first time. Enforced server-side, not by this schema.
 */
export const externalNotificationChannelRequestSchema = z.object({
  enabled: z.boolean(),
  url: z.string().max(2000),
});

export const externalNotificationSettingsRequestSchema = z.object({
  ntfy: externalNotificationChannelRequestSchema,
  discord: externalNotificationChannelRequestSchema,
});

export type ExternalNotificationSettingsRequestBody = z.infer<
  typeof externalNotificationSettingsRequestSchema
>;
