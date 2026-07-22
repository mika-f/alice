import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.coerce.boolean().default(false),

  DATABASE_URL: z.string().default("./data/wallet.sqlite"),

  HSD_NODE_URL: z.string().url(),
  HSD_NODE_API_KEY: z.string().min(1),
  HSD_WALLET_URL: z.string().url(),
  HSD_WALLET_API_KEY: z.string().min(1),
  HSD_WALLET_ID: z.string().min(1),
  HSD_NETWORK: z.enum(["main", "testnet", "regtest", "simnet"]).default("main"),

  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  return result.data;
}
