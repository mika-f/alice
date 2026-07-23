import type { Network } from "@alice-hns-wallet/domain";
import type { ConnectionConfig, ConnectionTestResult } from "@alice-hns-wallet/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getConnection, saveConnection, testConnection } from "../api/connection.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const connectionSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/connection",
  component: ConnectionSettingsPage,
});

const NETWORKS: Network[] = ["main", "testnet", "regtest", "simnet"];

const emptyForm: ConnectionConfig = {
  displayName: "",
  nodeUrl: "",
  walletUrl: "",
  nodeApiKey: "",
  walletApiKey: "",
  walletId: "",
  network: "main",
  timeoutMs: 10_000,
  tlsVerify: true,
};

function ConnectionSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const currentConnection = useQuery({ queryKey: ["connection"], queryFn: getConnection });

  const [form, setForm] = useState<ConnectionConfig>(emptyForm);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (currentConnection.data) {
      setForm((prev) => ({ ...prev, ...currentConnection.data, nodeApiKey: "", walletApiKey: "" }));
    }
  }, [currentConnection.data]);

  function updateField<K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  }

  const testMutation = useMutation({
    mutationFn: () => testConnection(form),
    onSuccess: setTestResult,
  });

  const saveMutation = useMutation({
    mutationFn: () => saveConnection(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connection"] });
      setSaveError(null);
      setNeedsReauth(false);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 403) {
        setNeedsReauth(true);
      } else if (error instanceof ApiError) {
        setSaveError(error.message);
      }
    },
  });

  const reauthMutation = useMutation({
    mutationFn: () => reauth({ method: "password", password: reauthPassword }),
    onSuccess: () => {
      setNeedsReauth(false);
      setReauthPassword("");
      saveMutation.mutate();
    },
  });

  const testPassed =
    testResult?.authenticated && testResult.networkMatches && testResult.walletUsable;

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Connection settings</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <p>
        <Link to="/settings/import-wallet">Restore a wallet from mnemonic</Link>
      </p>

      {saveError && <div className="error-banner">{saveError}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Changing the hsd connection requires re-authentication.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reauthMutation.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="reauth-password">Password</label>
              <input
                id="reauth-password"
                type="password"
                autoComplete="current-password"
                required
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="button" disabled={reauthMutation.isPending}>
              Confirm and save
            </button>
          </form>
        </div>
      )}

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            required
            value={form.displayName}
            onChange={(e) => updateField("displayName", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="nodeUrl">Node API URL</label>
          <input
            id="nodeUrl"
            required
            value={form.nodeUrl}
            onChange={(e) => updateField("nodeUrl", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="nodeApiKey">Node API key</label>
          <input
            id="nodeApiKey"
            type="password"
            required
            value={form.nodeApiKey}
            onChange={(e) => updateField("nodeApiKey", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="walletUrl">Wallet API URL</label>
          <input
            id="walletUrl"
            required
            value={form.walletUrl}
            onChange={(e) => updateField("walletUrl", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="walletApiKey">Wallet API key</label>
          <input
            id="walletApiKey"
            type="password"
            required
            value={form.walletApiKey}
            onChange={(e) => updateField("walletApiKey", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="walletId">Wallet ID</label>
          <input
            id="walletId"
            required
            value={form.walletId}
            onChange={(e) => updateField("walletId", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="network">Network</label>
          <select
            id="network"
            value={form.network}
            onChange={(e) => updateField("network", e.target.value as Network)}
          >
            {NETWORKS.map((network) => (
              <option key={network} value={network}>
                {network}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="timeoutMs">Timeout (ms)</label>
          <input
            id="timeoutMs"
            type="number"
            min={1000}
            max={60_000}
            value={form.timeoutMs}
            onChange={(e) => updateField("timeoutMs", Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="tlsVerify">
            <input
              id="tlsVerify"
              type="checkbox"
              checked={form.tlsVerify}
              onChange={(e) => updateField("tlsVerify", e.target.checked)}
            />{" "}
            Verify TLS certificates
          </label>
        </div>

        {testResult && (
          <div className={testPassed ? "success-banner" : "error-banner"}>
            <div>Node reachable: {String(testResult.nodeReachable)}</div>
            <div>Wallet reachable: {String(testResult.walletReachable)}</div>
            <div>Network matches: {String(testResult.networkMatches)}</div>
            <div>hsd version: {testResult.hsdVersion ?? "unknown"}</div>
            {testResult.errors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        )}

        <div className="field-row">
          <button
            type="button"
            className="button secondary"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </button>
          <button type="submit" className="button" disabled={!testPassed || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </main>
  );
}
