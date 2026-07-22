import { useMutation } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { importMnemonic } from "../api/wallet.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const importWalletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/import-wallet",
  component: ImportWalletPage,
});

function ImportWalletPage() {
  const navigate = useNavigate();
  const session = useSession();

  const [walletId, setWalletId] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const wordCountValid = [12, 15, 18, 21, 24].includes(wordCount);

  const importMutation = useMutation({
    mutationFn: () =>
      importMnemonic({ walletId, mnemonic: mnemonic.trim(), passphrase: passphrase || undefined }),
    onSuccess: () => {
      setDone(true);
      setNeedsReauth(false);
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsReauth(true);
      } else if (err instanceof ApiError) {
        setError(err.message);
      }
    },
  });

  const reauthMutation = useMutation({
    mutationFn: () => reauth({ method: "password", password: reauthPassword }),
    onSuccess: () => {
      setNeedsReauth(false);
      setReauthPassword("");
      importMutation.mutate();
    },
  });

  if (done) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Wallet imported</h1>
          <Link to="/">Back to dashboard</Link>
        </div>
        <div className="success-banner">
          Wallet <code>{walletId}</code> was created from the mnemonic and a rescan was started. Go
          to Connection settings to make it the active wallet.
        </div>
        <p>
          <Link to="/settings/connection">Connection settings</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Restore from mnemonic</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <p className="muted">
        This creates a new wallet on the connected hs-wallet instance. It does not change which
        wallet this app is currently using — do that afterward in Connection settings.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Importing a wallet requires re-authentication.</p>
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
              Confirm and import
            </button>
          </form>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          importMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="walletId">New wallet ID</label>
          <input
            id="walletId"
            required
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mnemonic">Mnemonic</label>
          <input
            id="mnemonic"
            required
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            autoComplete="off"
          />
          {mnemonic && (
            <span className="muted">
              {wordCount} words {wordCountValid ? "" : "(expected 12/15/18/21/24)"}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="passphrase">Passphrase (optional, BIP-39)</label>
          <input
            id="passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          className="button"
          disabled={!wordCountValid || importMutation.isPending}
        >
          {importMutation.isPending ? "Importing…" : "Import wallet"}
        </button>
      </form>
    </main>
  );
}
