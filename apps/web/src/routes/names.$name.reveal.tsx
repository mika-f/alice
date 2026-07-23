import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { previewRevealName, revealName, type BroadcastResultResponse } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { shakeshiftNameUrl, shakeshiftTransactionUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameRevealRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/reveal",
  component: NameRevealPage,
});

function NameRevealPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameRevealRoute.id });

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
    mutationFn: () => previewRevealName(name),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const revealMutation = useMutation({
    mutationFn: () => revealName(name),
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
      revealMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Bid revealed</h1>
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
        <p className="muted">
          <a href={shakeshiftNameUrl(name)} target="_blank" rel="noopener noreferrer">
            View {name} on Shakeshift
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Reveal your bid on {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      <div className="error-banner">
        <p>
          <strong>Reveal before the window closes.</strong> If you don't reveal your bid before the
          reveal period ends, the entire locked-up amount is forfeited permanently — not just the
          bid, the full lockup.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Revealing a bid requires re-authentication.</p>
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
              Confirm and reveal
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
                disabled={revealMutation.isPending}
                onClick={() => revealMutation.mutate()}
              >
                {revealMutation.isPending ? "Revealing…" : "Confirm reveal"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
