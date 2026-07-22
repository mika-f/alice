import type { ConnectionConfig, ConnectionTestResult } from "@alice-hns-wallet/schemas";
import { isNetwork, type Network } from "@alice-hns-wallet/domain";
import {
  HsdV8Adapter,
  isSupportedHsdVersion,
  type HsdV8AdapterOptions,
} from "@alice-hns-wallet/hsd-client";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto/encryption.js";
import type { Db } from "../db/client.js";
import { connections } from "../db/schema.js";
import type { Env } from "../env.js";

export interface ResolvedConnection {
  displayName: string;
  nodeUrl: string;
  walletUrl: string;
  nodeApiKey: string;
  walletApiKey: string;
  walletId: string;
  network: Network;
  timeoutMs: number;
  tlsVerify: boolean;
}

/** Never includes the API keys; safe to return to the browser (spec §21.1). */
export type SafeConnection = Omit<ResolvedConnection, "nodeApiKey" | "walletApiKey">;

function toResolved(
  row: typeof connections.$inferSelect,
  encryptionKey: string,
): ResolvedConnection {
  const network = row.network;
  if (!isNetwork(network)) {
    throw new Error(`Stored connection has an invalid network: ${network}`);
  }
  return {
    displayName: row.displayName,
    nodeUrl: row.nodeUrl,
    walletUrl: row.walletUrl,
    nodeApiKey: decrypt(row.nodeApiKeyEnc, encryptionKey),
    walletApiKey: decrypt(row.walletApiKeyEnc, encryptionKey),
    walletId: row.walletId,
    network,
    timeoutMs: row.timeoutMs,
    tlsVerify: row.tlsVerify,
  };
}

/** Spec §8.1/§24.1: env vars are the initial connection until saved to the DB. */
function fromEnv(env: Env): ResolvedConnection {
  return {
    displayName: "Default (from environment)",
    nodeUrl: env.HSD_NODE_URL,
    walletUrl: env.HSD_WALLET_URL,
    nodeApiKey: env.HSD_NODE_API_KEY,
    walletApiKey: env.HSD_WALLET_API_KEY,
    walletId: env.HSD_WALLET_ID,
    network: env.HSD_NETWORK,
    timeoutMs: 10_000,
    tlsVerify: true,
  };
}

export function getActiveConnection(db: Db, env: Env, encryptionKey: string): ResolvedConnection {
  const [row] = db.select().from(connections).all();
  return row ? toResolved(row, encryptionKey) : fromEnv(env);
}

export function toSafeConnection(connection: ResolvedConnection): SafeConnection {
  const { nodeApiKey: _nodeApiKey, walletApiKey: _walletApiKey, ...safe } = connection;
  return safe;
}

export function saveConnection(db: Db, encryptionKey: string, input: ConnectionConfig): void {
  const values = {
    displayName: input.displayName,
    nodeUrl: input.nodeUrl,
    walletUrl: input.walletUrl,
    nodeApiKeyEnc: encrypt(input.nodeApiKey, encryptionKey),
    walletApiKeyEnc: encrypt(input.walletApiKey, encryptionKey),
    walletId: input.walletId,
    network: input.network,
    timeoutMs: input.timeoutMs,
    tlsVerify: input.tlsVerify,
    updatedAt: new Date(),
  };

  const [existing] = db.select({ id: connections.id }).from(connections).all();
  if (existing) {
    db.update(connections).set(values).where(eq(connections.id, existing.id)).run();
  } else {
    db.insert(connections).values(values).run();
  }
}

function toAdapterOptions(connection: ResolvedConnection): HsdV8AdapterOptions {
  return {
    nodeUrl: connection.nodeUrl,
    nodeApiKey: connection.nodeApiKey,
    walletUrl: connection.walletUrl,
    walletApiKey: connection.walletApiKey,
    walletId: connection.walletId,
    timeoutMs: connection.timeoutMs,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Spec §8.3: every check that must pass before a connection is saved. */
export async function testConnection(
  connection: ResolvedConnection,
): Promise<ConnectionTestResult> {
  const errors: string[] = [];
  const options = toAdapterOptions(connection);

  let nodeAuthenticated = false;
  let hsdVersion: string | null = null;
  let nodeNetwork: Network | null = null;

  try {
    const status = await new HsdV8Adapter(options).getStatus();
    nodeAuthenticated = true;
    hsdVersion = status.version;
    nodeNetwork = status.network;
  } catch (error) {
    errors.push(`Node API unreachable or unauthorized: ${errorMessage(error)}`);
  }

  let walletAuthenticated = false;
  try {
    await new HsdV8Adapter(options).getBalance();
    walletAuthenticated = true;
  } catch (error) {
    errors.push(
      `Wallet API unreachable, unauthorized, or wallet ID not found: ${errorMessage(error)}`,
    );
  }

  const networkMatches = nodeNetwork !== null && nodeNetwork === connection.network;
  if (nodeNetwork !== null && !networkMatches) {
    errors.push(
      `Node network (${nodeNetwork}) does not match configured network (${connection.network})`,
    );
  }

  if (hsdVersion !== null && !isSupportedHsdVersion(hsdVersion)) {
    errors.push(`hsd version ${hsdVersion} is outside the supported 8.x range`);
  }

  return {
    nodeReachable: nodeAuthenticated,
    walletReachable: walletAuthenticated,
    authenticated: nodeAuthenticated && walletAuthenticated,
    hsdVersion,
    networkMatches,
    walletExists: walletAuthenticated,
    walletUsable: walletAuthenticated,
    errors,
  };
}
