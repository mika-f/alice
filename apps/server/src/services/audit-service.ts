import { desc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog } from "../db/schema.js";

export type AuditOutcome = "success" | "failure";

export interface AuditLogInput {
  action: string;
  target?: string | null;
  outcome: AuditOutcome;
  /** A short, pre-built human message only — never a raw request body (spec §21.6 redaction). */
  detail?: string | null;
  ip?: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  target: string | null;
  outcome: AuditOutcome;
  detail: string | null;
  ip: string | null;
  createdAt: number;
}

function toEntry(row: typeof auditLog.$inferSelect): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    target: row.target,
    outcome: row.outcome as AuditOutcome,
    detail: row.detail,
    ip: row.ip,
    createdAt: row.createdAt.getTime(),
  };
}

export function recordAudit(db: Db, input: AuditLogInput): void {
  db.insert(auditLog)
    .values({
      action: input.action,
      target: input.target ?? null,
      outcome: input.outcome,
      detail: input.detail ?? null,
      ip: input.ip ?? null,
    })
    .run();
}

export function listAuditLog(db: Db, limit = 200): AuditLogEntry[] {
  const rows = db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all();
  return rows.map(toEntry);
}
