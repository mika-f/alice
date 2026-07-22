import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { previewTransferName, transferName, type BroadcastResultResponse } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const nameTransferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/transfer",
  component: NameTransferPage,
});

function NameTransferPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameTransferRoute.id });

  const [address, setAddress] = useState("");
  const [nameReentry, setNameReentry] = useState("");
  const [preview, setPreview] = useState<BroadcastResultResponse | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [result, setResult] = useState<BroadcastResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const previewMutation = useMutation({
    mutationFn: () => previewTransferName(name, address),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const transferMutation = useMutation({
    mutationFn: () => transferName(name, address),
    onSuccess: (broadcast) => {
      setResult(broadcast);
      setNeedsReauth(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["name", name] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
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
      transferMutation.mutate();
    },
  });

  const nameReentryOk = nameReentry === name;

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Transfer started</h1>
          <Link to="/names/$name" params={{ name }}>
            Back to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID: <code>{result.txid}</code>
        </div>
        <p className="muted">
          The transfer must clear a lockup period on-chain before it can be finalized. Check the
          name's detail page to see when Finalize becomes available.
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Transfer {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Transferring a name requires re-authentication.</p>
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
              Confirm and transfer
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <p className="muted">
          Transferring a name moves ownership to another address. Handshake enforces a lockup period
          on-chain after you start a transfer, during which it cannot be finalized — this gives you
          a window to notice and cancel an unauthorized transfer. Only transfer to an address you
          control or fully trust.
        </p>

        <div className="field">
          <label htmlFor="transfer-address">Destination address</label>
          <input
            id="transfer-address"
            required
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setPreview(null);
            }}
          />
        </div>

        {!preview ? (
          <button
            type="button"
            className="button"
            disabled={!address || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Estimating…" : "Estimate fee"}
          </button>
        ) : (
          <>
            <div className="success-banner">
              <p>Fee: {preview.fee} dollarydoos</p>
              <p>Destination: {address}</p>
            </div>

            <div className="field">
              <label htmlFor="name-reentry">Type "{name}" to confirm</label>
              <input
                id="name-reentry"
                value={nameReentry}
                onChange={(e) => setNameReentry(e.target.value)}
              />
            </div>

            <div className="field-row">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>
                Back
              </button>
              <button
                type="button"
                className="button"
                disabled={!nameReentryOk || transferMutation.isPending}
                onClick={() => transferMutation.mutate()}
              >
                {transferMutation.isPending ? "Starting transfer…" : "Confirm transfer"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
