import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import {
  finalizeName,
  getName,
  previewFinalizeName,
  type BroadcastResultResponse,
} from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { shakeshiftNameUrl, shakeshiftTransactionUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameFinalizeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/finalize",
  component: NameFinalizePage,
});

function NameFinalizePage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameFinalizeRoute.id });

  const detailQuery = useQuery({
    queryKey: ["name", name],
    queryFn: () => getName(name),
    enabled: session.data?.authenticated === true,
  });

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
    mutationFn: () => previewFinalizeName(name),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeName(name),
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
      finalizeMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Transfer finalized</h1>
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
        <h1>Finalize transfer: {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Finalizing a transfer requires re-authentication.</p>
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
              Confirm and finalize
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <p className="muted">
          This completes a transfer you already started. Double check on the name's detail page that
          the transfer state and history are what you expect before finalizing — this step is
          irreversible.
        </p>
        {detailQuery.data && (
          <p>
            <strong>Transfer state:</strong> {detailQuery.data.transferState}
          </p>
        )}

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
            <p>Fee: {preview.fee} dollarydoos</p>
            <div className="field-row">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>
                Back
              </button>
              <button
                type="button"
                className="button"
                disabled={finalizeMutation.isPending}
                onClick={() => finalizeMutation.mutate()}
              >
                {finalizeMutation.isPending ? "Finalizing…" : "Confirm finalize"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
