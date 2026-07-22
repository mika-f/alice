import { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import type { Env } from "./env.js";

export function createHsdClient(env: Env): HsdV8Adapter {
  return new HsdV8Adapter({
    nodeUrl: env.HSD_NODE_URL,
    nodeApiKey: env.HSD_NODE_API_KEY,
    walletUrl: env.HSD_WALLET_URL,
    walletApiKey: env.HSD_WALLET_API_KEY,
    walletId: env.HSD_WALLET_ID,
  });
}
