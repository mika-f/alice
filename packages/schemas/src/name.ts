import { z } from "zod";

export const nameMetaRequestSchema = z.object({
  label: z.string().max(200).optional(),
  memo: z.string().max(1000).optional(),
});

export type NameMetaRequestBody = z.infer<typeof nameMetaRequestSchema>;
