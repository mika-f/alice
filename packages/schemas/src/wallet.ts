import { z } from "zod";

/** Smallest-unit amount as a decimal string — avoids float precision loss and JSON's lack of bigint. */
export const sendRequestSchema = z.object({
  address: z.string().min(1),
  amount: z.string().regex(/^\d+$/, "amount must be a decimal integer string"),
  feeRate: z.number().int().positive().optional(),
  label: z.string().max(200).optional(),
  memo: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(1).max(128),
});

export const unlockRequestSchema = z.object({
  passphrase: z.string().min(1),
  timeoutSeconds: z.number().int().positive().max(86_400),
});

export const mnemonicImportRequestSchema = z.object({
  walletId: z.string().min(1).max(64),
  mnemonic: z.string().min(1),
  passphrase: z.string().optional(),
});

export const addressLabelRequestSchema = z.object({
  label: z.string().max(200).nullable(),
});

export const txMetaRequestSchema = z.object({
  label: z.string().max(200).optional(),
  memo: z.string().max(1000).optional(),
});

export type SendRequestBody = z.infer<typeof sendRequestSchema>;
export type UnlockRequestBody = z.infer<typeof unlockRequestSchema>;
export type MnemonicImportRequestBody = z.infer<typeof mnemonicImportRequestSchema>;
export type AddressLabelRequestBody = z.infer<typeof addressLabelRequestSchema>;
export type TxMetaRequestBody = z.infer<typeof txMetaRequestSchema>;
