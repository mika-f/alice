import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { revokeName, type BroadcastResultResponse } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { shakeshiftTransactionUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameRevokeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/revoke",
  component: NameRevokePage,
});

function NameRevokePage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameRevokeRoute.id });

  const [nameReentry, setNameReentry] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [result, setResult] = useState<BroadcastResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const revokeMutation = useMutation({
    mutationFn: async () => {
      // The general reauth window (spec §7.4) is separate from revoke's own password+TOTP check
      // (spec §19.2) — refresh it with the same password first so the revoke call never 403s on
      // session staleness alone.
      await reauth({ method: "password", password });
      return revokeName(name, { password, code });
    },
    onSuccess: (broadcast) => {
      setResult(broadcast);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["name", name] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to revoke");
    },
  });

  const nameReentryOk = nameReentry === name;
  const canSubmit = nameReentryOk && password.length > 0 && code.length > 0 && finalConfirm;

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Revoked</h1>
          <Link to="/names/$name" params={{ name }}>
            Back to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID:{" "}
          <a href={shakeshiftTransactionUrl(result.txid)} target="_blank" rel="noopener noreferrer">
            <code>{result.txid}</code>
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Revoke {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      <div className="error-banner">
        <p>
          <strong>This is a dangerous, irreversible operation.</strong>
        </p>
        <p>
          Revoking permanently gives up the name. It cannot be undone, and the name only becomes
          available for others to bid on again after a lock-out period — you will not get it back
          automatically. Only revoke a name if you are certain you no longer want it, or need to
          disable a compromised name immediately.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          revokeMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="revoke-name-reentry">Type "{name}" to confirm</label>
          <input
            id="revoke-name-reentry"
            value={nameReentry}
            onChange={(e) => setNameReentry(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="revoke-password">Admin password</label>
          <input
            id="revoke-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="revoke-code">TOTP code (or recovery code)</label>
          <input id="revoke-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <label className="field-row">
          <input
            type="checkbox"
            checked={finalConfirm}
            onChange={(e) => setFinalConfirm(e.target.checked)}
          />
          I understand this cannot be undone and want to revoke {name}
        </label>

        <button
          type="submit"
          className="button danger"
          disabled={!canSubmit || revokeMutation.isPending}
        >
          {revokeMutation.isPending ? "Revoking…" : "Revoke permanently"}
        </button>
      </form>
    </main>
  );
}
