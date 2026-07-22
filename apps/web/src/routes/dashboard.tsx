import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { logout } from "../api/auth.js";
import { apiFetch } from "../api/client.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

interface StatusResponse {
  node: {
    connected: boolean;
    version: string | null;
    network: string | null;
    chainHeight: number | null;
    peerCount: number | null;
    synced: boolean;
    progress: number;
  };
  wallet: { connected: boolean };
}

function useStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => apiFetch<StatusResponse>("/api/status"),
    enabled,
    refetchInterval: 15_000,
  });
}

function DashboardPage() {
  const navigate = useNavigate();
  const session = useSession();
  const status = useStatus(session.data?.authenticated === true);

  useEffect(() => {
    if (!session.data) return;
    if (!session.data.setupComplete) {
      void navigate({ to: "/setup" });
    } else if (!session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Handshake Web Wallet</h1>
        {session.data?.authenticated && (
          <button type="button" className="link-button" onClick={() => void logout()}>
            Log out
          </button>
        )}
      </div>

      {session.data?.authenticated && (
        <>
          <div className="status-grid">
            <div className="status-tile">
              <div className="label">Node</div>
              <div className="value">
                {status.data?.node.connected ? "Connected" : "Disconnected"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Wallet</div>
              <div className="value">
                {status.data?.wallet.connected ? "Connected" : "Disconnected"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Chain height</div>
              <div className="value">{status.data?.node.chainHeight ?? "—"}</div>
            </div>
            <div className="status-tile">
              <div className="label">Peers</div>
              <div className="value">{status.data?.node.peerCount ?? "—"}</div>
            </div>
          </div>

          <p>
            <Link to="/settings/connection">Connection settings</Link>
          </p>
        </>
      )}
    </main>
  );
}
