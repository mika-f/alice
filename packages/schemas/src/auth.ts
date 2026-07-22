import { z } from "zod";

export const setupRequestSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(12).max(256),
});

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const loginTotpRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const reauthRequestSchema = z.union([
  z.object({ method: z.literal("password"), password: z.string().min(1) }),
  z.object({ method: z.literal("totp"), code: z.string().regex(/^\d{6}$/) }),
]);

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginTotpRequest = z.infer<typeof loginTotpRequestSchema>;
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;
