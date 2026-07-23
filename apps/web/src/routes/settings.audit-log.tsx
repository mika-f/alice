import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { listAuditLog } from "../api/audit-log.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/audit-log",
  component: AuditLogPage,
});

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function AuditLogPage() {
  const navigate = useNavigate();
  const session = useSession();

  const query = useQuery({
    queryKey: ["audit-log"],
    queryFn: listAuditLog,
    enabled: session.data?.authenticated === true,
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const entries = query.data ?? [];

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Audit log</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      {query.isLoading && <p className="muted">Loading…</p>}
      {entries.length === 0 && !query.isLoading && (
        <p className="muted">No activity recorded yet.</p>
      )}

      <ul className="audit-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="audit-main">
              <div className="audit-title">
                <strong>{entry.action}</strong>
                <span
                  className={`status-badge ${entry.outcome === "success" ? "status-badge-success" : "status-badge-error"}`}
                >
                  {entry.outcome}
                </span>
              </div>
              {entry.target && <span className="muted">{entry.target}</span>}
              {entry.detail && <span className="audit-detail">{entry.detail}</span>}
            </div>
            <span className="muted audit-time">
              {formatTimestamp(entry.createdAt)}
              {entry.ip && <> · {entry.ip}</>}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
