import { z } from "zod";

export const nameMetaRequestSchema = z.object({
  label: z.string().max(200).optional(),
  memo: z.string().max(1000).optional(),
});

export type NameMetaRequestBody = z.infer<typeof nameMetaRequestSchema>;

/** Mirrors @alice-hns-wallet/domain's DnsRecord union; kept independent since schemas can't import domain types. */
export const dnsRecordRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NS"), ns: z.string().min(1).max(255) }),
  z.object({
    type: z.literal("GLUE4"),
    ns: z.string().min(1).max(255),
    address: z.string().min(1),
  }),
  z.object({
    type: z.literal("GLUE6"),
    ns: z.string().min(1).max(255),
    address: z.string().min(1),
  }),
  z.object({
    type: z.literal("DS"),
    keyTag: z.number().int().min(0).max(0xffff),
    algorithm: z.number().int().min(0).max(0xff),
    digestType: z.number().int().min(0).max(0xff),
    digest: z.string().min(1),
  }),
  z.object({ type: z.literal("TXT"), text: z.array(z.string().max(255)).max(64) }),
  z.object({ type: z.literal("SYNTH4"), address: z.string().min(1) }),
  z.object({ type: z.literal("SYNTH6"), address: z.string().min(1) }),
  z.object({ type: z.literal("UNKNOWN"), raw: z.string().min(1) }),
]);

export const updateNameRequestSchema = z.object({
  records: z.array(dnsRecordRequestSchema).max(100),
});

export type UpdateNameRequestBody = z.infer<typeof updateNameRequestSchema>;

export const renewNamesBatchRequestSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(1000),
});

export type RenewNamesBatchRequestBody = z.infer<typeof renewNamesBatchRequestSchema>;

export const transferNameRequestSchema = z.object({
  address: z.string().min(1),
});

export type TransferNameRequestBody = z.infer<typeof transferNameRequestSchema>;

/** Spec §19.2: revoke needs both a fresh password and a fresh TOTP/recovery code, not the general single-factor reauth. */
export const revokeNameRequestSchema = z.object({
  password: z.string().min(1),
  code: z.string().min(1),
});

export type RevokeNameRequestBody = z.infer<typeof revokeNameRequestSchema>;

/** Spec §27.3: dust-unit decimal strings, converted from HNS with parseHnsToSmallestUnit on the client. */
export const bidNameRequestSchema = z.object({
  bid: z.string().min(1),
  lockup: z.string().min(1),
});

export type BidNameRequestBody = z.infer<typeof bidNameRequestSchema>;
