import { HsdV8Adapter } from "@alice-hns-wallet/hsd-client";
import type { Db } from "../db/client.js";
import type { Env } from "../env.js";
import { getActiveConnection, type ResolvedConnection } from "./connection-service.js";

/**
 * Holds the live hsd client so a saved connection change (spec §9.1) takes effect
 * immediately, without restarting the process.
 */
export class HsdConnectionManager {
  private adapter: HsdV8Adapter;
  private connection: ResolvedConnection;

  constructor(connection: ResolvedConnection) {
    this.connection = connection;
    this.adapter = HsdConnectionManager.buildAdapter(connection);
  }

  static fromEnvOrDb(db: Db, env: Env): HsdConnectionManager {
    return new HsdConnectionManager(getActiveConnection(db, env, env.ENCRYPTION_KEY));
  }

  private static buildAdapter(connection: ResolvedConnection): HsdV8Adapter {
    return new HsdV8Adapter({
      nodeUrl: connection.nodeUrl,
      nodeApiKey: connection.nodeApiKey,
      walletUrl: connection.walletUrl,
      walletApiKey: connection.walletApiKey,
      walletId: connection.walletId,
      timeoutMs: connection.timeoutMs,
    });
  }

  get(): HsdV8Adapter {
    return this.adapter;
  }

  getConnection(): ResolvedConnection {
    return this.connection;
  }

  reconfigure(connection: ResolvedConnection): void {
    this.connection = connection;
    this.adapter = HsdConnectionManager.buildAdapter(connection);
  }
}
