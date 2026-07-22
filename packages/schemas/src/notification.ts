import { z } from "zod";

/** Spec §17.4: any one of these being crossed triggers a renewal-approaching notification. */
export const renewalThresholdsRequestSchema = z.object({
  blocksRemaining: z.number().int().positive(),
  daysRemaining: z.number().positive(),
  expirationRatio: z.number().min(0).max(1),
});

export type RenewalThresholdsRequestBody = z.infer<typeof renewalThresholdsRequestSchema>;
