import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getDiagnostics } from "../api/diagnostics.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/diagnostics",
  component: DiagnosticsPage,
});

function statusText(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Yes" : "No";
}

function DiagnosticsPage() {
  const navigate = useNavigate();
  const session = useSession();

  const query = useQuery({
    queryKey: ["diagnostics"],
    queryFn: getDiagnostics,
    enabled: session.data?.authenticated === true,
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const data = query.data;

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Diagnostics</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <div className="field-row">
        <button
          type="button"
          className="button secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Checking…" : "Run diagnostics now"}
        </button>
      </div>

      {query.isLoading && <p className="muted">Checking…</p>}

      {data && (
        <>
          <div className="card diagnostic-card">
            <h1>Connection</h1>
            <div>Display name: {data.connection.displayName}</div>
            <div>Node URL: {data.connection.nodeUrl}</div>
            <div>Wallet URL: {data.connection.walletUrl}</div>
            <div>Wallet ID: {data.connection.walletId}</div>
            <div>Configured network: {data.connection.network}</div>
            <div>TLS verify: {String(data.connection.tlsVerify)}</div>
            <div>Timeout: {data.connection.timeoutMs}ms</div>
          </div>

          <div className="card diagnostic-card">
            <h1>Node</h1>
            <div>Reachable: {statusText(data.node.reachable)}</div>
            {data.node.error && <div className="error-text">{data.node.error}</div>}
            {data.node.status && (
              <>
                <div>Version: {data.node.status.version}</div>
                <div>Network: {data.node.status.network}</div>
                <div>Chain height: {data.node.status.chainHeight}</div>
                <div>Peers: {data.node.status.peerCount}</div>
                <div>
                  Synced: {statusText(data.node.status.synced)} (
                  {Math.round(data.node.status.progress * 100)}%)
                </div>
              </>
            )}
            <div>hsd version supported: {statusText(data.hsdVersionSupported)}</div>
          </div>

          <div className="card diagnostic-card">
            <h1>Wallet</h1>
            <div>Reachable: {statusText(data.wallet.reachable)}</div>
            {data.wallet.error && <div className="error-text">{data.wallet.error}</div>}
            {data.wallet.status && (
              <>
                <div>Network: {data.wallet.status.network}</div>
                <div>Wallet height: {data.wallet.status.walletHeight}</div>
                <div>Locked: {statusText(data.wallet.status.locked)}</div>
                <div>Rescanning: {statusText(data.wallet.status.rescanning)}</div>
              </>
            )}
            <div>Network matches node: {statusText(data.networkMatches)}</div>
          </div>

          <div className="card diagnostic-card">
            <h1>Warnings</h1>
            {data.warnings.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning.type}>{warning.message}</li>
                ))}
              </ul>
            )}
          </div>

          <p className="muted">Checked at {new Date(data.checkedAt).toLocaleString()}</p>
        </>
      )}
    </main>
  );
}
