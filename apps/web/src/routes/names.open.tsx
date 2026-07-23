import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import {
  getNameAvailability,
  openName,
  previewOpenName,
  type BroadcastResultResponse,
  type NameAvailabilityResponse,
} from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { shakeshiftNameUrl, shakeshiftTransactionUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameOpenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/open",
  component: NameOpenPage,
});

function NameOpenPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<NameAvailabilityResponse | null>(null);
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

  const availabilityMutation = useMutation({
    mutationFn: () => getNameAvailability(name),
    onSuccess: (a) => {
      setAvailability(a);
      setPreview(null);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Failed to check availability"),
  });

  const previewMutation = useMutation({
    mutationFn: () => previewOpenName(name),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const openMutation = useMutation({
    mutationFn: () => openName(name),
    onSuccess: (broadcast) => {
      setResult(broadcast);
      setNeedsReauth(false);
      setError(null);
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
      openMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Auction opened</h1>
          <Link to="/names/$name" params={{ name }}>
            Go to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID:{" "}
          <a href={shakeshiftTransactionUrl(result.txid)} target="_blank" rel="noopener noreferrer">
            <code>{result.txid}</code>
          </a>
        </div>
        <p className="muted">
          Bidding opens after a short delay while this confirms on-chain. Check the name's detail
          page to place a bid once it enters the bidding state.
        </p>
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
        <h1>Open a new Name auction</h1>
        <Link to="/names">Cancel</Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Opening a Name auction requires re-authentication.</p>
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
              Confirm and open
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="field">
          <label htmlFor="open-name">Name</label>
          <input
            id="open-name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setAvailability(null);
              setPreview(null);
            }}
          />
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={!name || availabilityMutation.isPending}
          onClick={() => availabilityMutation.mutate()}
        >
          {availabilityMutation.isPending ? "Checking…" : "Check availability"}
        </button>

        {availability && (
          <div className={availability.available ? "success-banner" : "error-banner"}>
            {availability.available && <p>{availability.name} is available to open.</p>}
            {availability.reserved && (
              <p>
                {availability.name} is reserved and cannot be opened via a normal auction — this app
                doesn't support claiming reserved names.
              </p>
            )}
            {!availability.available && !availability.reserved && availability.state && (
              <p>
                {availability.name} is already {availability.state}.{" "}
                <Link to="/names/$name" params={{ name: availability.name }}>
                  View it
                </Link>
                .
              </p>
            )}
          </div>
        )}

        {availability?.available &&
          (!preview ? (
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
                  disabled={openMutation.isPending}
                  onClick={() => openMutation.mutate()}
                >
                  {openMutation.isPending ? "Opening…" : "Open auction"}
                </button>
              </div>
            </>
          ))}
      </div>
    </main>
  );
}
