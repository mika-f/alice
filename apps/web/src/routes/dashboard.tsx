import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { logout } from "../api/auth.js";
import { apiFetch } from "../api/client.js";
import { getBalance, lockWallet, unlockWallet } from "../api/wallet.js";
import { useSession } from "../hooks/useSession.js";
import { formatHns } from "../lib/hns.js";
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
  wallet: { connected: boolean; walletHeight: number | null; locked: boolean; rescanning: boolean };
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
  const queryClient = useQueryClient();
  const status = useStatus(session.data?.authenticated === true);
  const balanceQuery = useQuery({
    queryKey: ["balance"],
    queryFn: getBalance,
    enabled: session.data?.authenticated === true,
  });

  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [unlockMinutes, setUnlockMinutes] = useState("10");
  const [showUnlock, setShowUnlock] = useState(false);

  useEffect(() => {
    if (!session.data) return;
    if (!session.data.setupComplete) {
      void navigate({ to: "/setup" });
    } else if (!session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const lockMutation = useMutation({
    mutationFn: lockWallet,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const unlockMutation = useMutation({
    mutationFn: () => unlockWallet(unlockPassphrase, Number(unlockMinutes) * 60),
    onSuccess: () => {
      setShowUnlock(false);
      setUnlockPassphrase("");
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

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
          {status.data && !status.data.node.connected && (
            <div className="error-banner">Node is unreachable.</div>
          )}
          {status.data && !status.data.wallet.connected && (
            <div className="error-banner">Wallet is unreachable.</div>
          )}

          <div className="status-grid">
            <div className="status-tile">
              <div className="label">Confirmed</div>
              <div className="value">
                {balanceQuery.data ? formatHns(balanceQuery.data.confirmed) : "—"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Spendable</div>
              <div className="value">
                {balanceQuery.data ? formatHns(balanceQuery.data.spendable) : "—"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Unconfirmed</div>
              <div className="value">
                {balanceQuery.data ? formatHns(balanceQuery.data.unconfirmed) : "—"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Locked</div>
              <div className="value">
                {balanceQuery.data ? formatHns(balanceQuery.data.locked) : "—"}
              </div>
            </div>
          </div>

          <div className="status-grid">
            <div className="status-tile">
              <div className="label">Node</div>
              <div className="value">
                {status.data?.node.connected ? "Connected" : "Disconnected"}
              </div>
            </div>
            <div className="status-tile">
              <div className="label">Wallet lock</div>
              <div className="value">{status.data?.wallet.locked ? "Locked" : "Unlocked"}</div>
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

          <div className="field-row">
            <Link to="/send" className="button">
              Send
            </Link>
            <Link to="/receive" className="button secondary">
              Receive
            </Link>
            <Link to="/transactions" className="button secondary">
              History
            </Link>
            <Link to="/names" className="button secondary">
              Names
            </Link>
          </div>

          <div className="card">
            <h1>Wallet lock</h1>
            {status.data?.wallet.locked ? (
              showUnlock ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    unlockMutation.mutate();
                  }}
                >
                  <div className="field">
                    <label htmlFor="unlock-passphrase">Wallet passphrase</label>
                    <input
                      id="unlock-passphrase"
                      type="password"
                      required
                      value={unlockPassphrase}
                      onChange={(e) => setUnlockPassphrase(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="unlock-minutes">Unlock for (minutes)</label>
                    <input
                      id="unlock-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={unlockMinutes}
                      onChange={(e) => setUnlockMinutes(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="button" disabled={unlockMutation.isPending}>
                    Unlock
                  </button>
                </form>
              ) : (
                <button type="button" className="button" onClick={() => setShowUnlock(true)}>
                  Unlock wallet
                </button>
              )
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() => lockMutation.mutate()}
              >
                Lock wallet now
              </button>
            )}
          </div>

          <p>
            <Link to="/settings/connection">Connection settings</Link>
          </p>
        </>
      )}
    </main>
  );
}
