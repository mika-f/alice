import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { previewRedeemName, redeemName, type BroadcastResultResponse } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const nameRedeemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/redeem",
  component: NameRedeemPage,
});

function NameRedeemPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameRedeemRoute.id });

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
    mutationFn: () => previewRedeemName(name),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const redeemMutation = useMutation({
    mutationFn: () => redeemName(name),
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
      redeemMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Lockup redeemed</h1>
          <Link to="/names/$name" params={{ name }}>
            Back to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID: <code>{result.txid}</code>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Redeem your bid on {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      <p className="muted">
        Recovers the locked-up amount from a losing, already-revealed bid. If this bid actually won
        the auction, hsd will reject the redeem — this app doesn't determine the winner itself.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Redeeming a bid requires re-authentication.</p>
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
              Confirm and redeem
            </button>
          </form>
        </div>
      )}

      <div className="card">
        {!preview ? (
          <button
            type="button"
            className="button"
            disabled={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Estimating…" : "Estimate fee"}
          </button>
        ) : (
          <>
            <div className="success-banner">
              <p>Fee: {preview.fee} dollarydoos</p>
            </div>
            <div className="field-row">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>
                Back
              </button>
              <button
                type="button"
                className="button"
                disabled={redeemMutation.isPending}
                onClick={() => redeemMutation.mutate()}
              >
                {redeemMutation.isPending ? "Redeeming…" : "Confirm redeem"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
