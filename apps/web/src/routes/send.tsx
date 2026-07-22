import { useMutation, useQuery } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { estimateSend, getBalance, sendHns, type BroadcastResultResponse } from "../api/wallet.js";
import { useSession } from "../hooks/useSession.js";
import { formatHns, parseHnsToSmallestUnit } from "../lib/hns.js";
import { rootRoute } from "./root.js";

export const sendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/send",
  component: SendPage,
});

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function SendPage() {
  const navigate = useNavigate();
  const session = useSession();
  const balanceQuery = useQuery({ queryKey: ["balance"], queryFn: getBalance });

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [memo, setMemo] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());
  const [estimate, setEstimate] = useState<BroadcastResultResponse | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [result, setResult] = useState<BroadcastResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  function buildInput() {
    return {
      address,
      amount: parseHnsToSmallestUnit(amount),
      idempotencyKey,
      label: label || undefined,
      memo: memo || undefined,
    };
  }

  const estimateMutation = useMutation({
    mutationFn: () => estimateSend(buildInput()),
    onSuccess: setEstimate,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to estimate fee"),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendHns(buildInput()),
    onSuccess: (broadcast) => {
      setResult(broadcast);
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
      sendMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>Sent</h1>
          <Link to="/">Back to dashboard</Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID: <code>{result.txid}</code>
        </div>
        <p className="muted">
          If anything goes wrong reporting this, check the transaction history before sending again
          — this app never auto-retries a broadcast.
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Send HNS</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      {balanceQuery.data && (
        <p className="muted">Spendable: {formatHns(balanceQuery.data.spendable)} HNS</p>
      )}

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Sending HNS requires re-authentication.</p>
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
              Confirm and send
            </button>
          </form>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!estimate) {
            estimateMutation.mutate();
          } else {
            sendMutation.mutate();
          }
        }}
      >
        <div className="field">
          <label htmlFor="address">Recipient address</label>
          <input
            id="address"
            required
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setEstimate(null);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="amount">Amount (HNS)</label>
          <input
            id="amount"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setEstimate(null);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="label">Label (local only)</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="memo">Memo (local only)</label>
          <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>

        {estimate && (
          <div className="success-banner">
            <div>Fee: {formatHns(estimate.fee)} HNS</div>
            <div>
              Total:{" "}
              {formatHns(
                (BigInt(parseHnsToSmallestUnit(amount || "0")) + BigInt(estimate.fee)).toString(),
              )}{" "}
              HNS
            </div>
          </div>
        )}

        {!estimate ? (
          <button type="submit" className="button" disabled={estimateMutation.isPending}>
            {estimateMutation.isPending ? "Estimating…" : "Review"}
          </button>
        ) : (
          <div className="field-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setEstimate(null);
                setIdempotencyKey(newIdempotencyKey());
              }}
            >
              Edit
            </button>
            <button type="submit" className="button" disabled={sendMutation.isPending}>
              {sendMutation.isPending ? "Sending…" : "Confirm and send"}
            </button>
          </div>
        )}
      </form>
    </main>
  );
}
