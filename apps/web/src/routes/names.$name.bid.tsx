import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { bidName, previewBidName, type BroadcastResultResponse } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { parseHnsToSmallestUnit } from "../lib/hns.js";
import { rootRoute } from "./root.js";

export const nameBidRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/bid",
  component: NameBidPage,
});

function NameBidPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameBidRoute.id });

  const [bid, setBid] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lockup, setLockup] = useState("");
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

  // Lockup defaults to the bid amount (no privacy padding) unless the advanced field is used.
  const effectiveLockup = showAdvanced ? lockup : bid;
  const bidValid = bid !== "" && Number(bid) > 0;
  const lockupValid =
    effectiveLockup !== "" &&
    BigInt(parseHnsToSmallestUnit(effectiveLockup || "0")) >=
      BigInt(parseHnsToSmallestUnit(bid || "0"));

  function input(): { bid: string; lockup: string } {
    return {
      bid: parseHnsToSmallestUnit(bid),
      lockup: parseHnsToSmallestUnit(effectiveLockup),
    };
  }

  const previewMutation = useMutation({
    mutationFn: () => previewBidName(name, input()),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const bidMutation = useMutation({
    mutationFn: () => bidName(name, input()),
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
      bidMutation.mutate();
    },
  });

  const nameReentryOk = nameReentry === name;

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Bid placed</h1>
          <Link to="/names/$name" params={{ name }}>
            Back to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID: <code>{result.txid}</code>
        </div>
        <p className="muted">
          Your lockup is locked until the reveal period. You must come back and reveal your bid once
          the name enters its reveal window, or you will forfeit the entire lockup.
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Bid on {name}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Placing a bid requires re-authentication.</p>
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
              Confirm and bid
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <p className="muted">
          Your bid amount stays hidden from other bidders until you reveal it. The lockup (what you
          publicly commit) is fully locked on-chain until reveal — missing the reveal window
          forfeits the entire lockup, not just the bid.
        </p>

        <div className="field">
          <label htmlFor="bid-amount">Bid amount (HNS)</label>
          <input
            id="bid-amount"
            type="number"
            min="0"
            step="any"
            required
            value={bid}
            onChange={(e) => {
              setBid(e.target.value);
              setPreview(null);
            }}
          />
        </div>

        <label className="field-row">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => {
              setShowAdvanced(e.target.checked);
              setPreview(null);
            }}
          />
          Increase lockup for extra privacy
        </label>

        {showAdvanced && (
          <div className="field">
            <label htmlFor="lockup-amount">Lockup amount (HNS)</label>
            <input
              id="lockup-amount"
              type="number"
              min="0"
              step="any"
              value={lockup}
              onChange={(e) => {
                setLockup(e.target.value);
                setPreview(null);
              }}
            />
            {!lockupValid && lockup !== "" && (
              <p className="error-banner">Lockup cannot be lower than the bid.</p>
            )}
          </div>
        )}

        {!preview ? (
          <button
            type="button"
            className="button"
            disabled={!bidValid || !lockupValid || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Estimating…" : "Estimate fee"}
          </button>
        ) : (
          <>
            <div className="success-banner">
              <p>Fee: {preview.fee} dollarydoos</p>
              <p>Bid: {bid} HNS</p>
              <p>Lockup: {effectiveLockup} HNS</p>
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
                disabled={!nameReentryOk || bidMutation.isPending}
                onClick={() => bidMutation.mutate()}
              >
                {bidMutation.isPending ? "Placing bid…" : "Confirm bid"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
