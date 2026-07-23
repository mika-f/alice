import { describeCovenant, type CovenantType } from "@alice-hns-wallet/domain";
import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getTransactions, setTxMeta, type TransactionResponse } from "../api/wallet.js";
import { useSession } from "../hooks/useSession.js";
import { formatHns } from "../lib/hns.js";
import { rootRoute } from "./root.js";

export const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsPage,
});

function outputSummary(tx: TransactionResponse): string {
  const covenants = new Set(tx.outputs.map((output) => output.covenant));
  if (covenants.size === 1 && covenants.has("NONE")) return "";
  return Array.from(covenants)
    .filter((action) => action !== "NONE")
    .map((action) => describeCovenant(action as CovenantType))
    .join(", ");
}

function TransactionsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<TransactionResponse[][]>([]);

  const query = useQuery({
    queryKey: ["transactions", cursor],
    queryFn: () => getTransactions({ cursor, limit: 20 }),
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (query.data) {
      setPages((prev) => (cursor ? [...prev, query.data.items] : [query.data.items]));
    }
  }, [query.data]);

  async function editMeta(tx: TransactionResponse) {
    const label = window.prompt("Label", tx.label ?? "") ?? undefined;
    const memo = window.prompt("Memo", tx.memo ?? "") ?? undefined;
    await setTxMeta(tx.txid, { label, memo });
    setPages([]);
    setCursor(undefined);
    void query.refetch();
  }

  const items = pages.flat();
  const nextCursor = query.data?.nextCursor ?? null;

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Transaction history</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <div className="activity-list">
        {items.map((tx) => (
          <article key={tx.txid} className="activity-item">
            <div className={`activity-icon ${tx.kind === "receive" ? "receive" : "send"}`}>
              {tx.kind === "receive" ? "↓" : "↑"}
            </div>
            <div className="activity-item-main">
              <div className="activity-item-title">
                <strong>{tx.kind === "receive" ? "Received HNS" : "Sent HNS"}</strong>
                <span
                  className={`status-badge ${tx.status === "confirmed" ? "status-badge-success" : "status-badge-muted"}`}
                >
                  {tx.status}
                </span>
              </div>
              <span className="muted">
                {outputSummary(tx) || "Wallet transaction"} · <code>{tx.txid}</code>
              </span>
              {(tx.label || tx.memo) && (
                <span className="activity-note">{tx.label || tx.memo}</span>
              )}
            </div>
            <strong
              className={`activity-amount ${tx.kind === "receive" ? "positive" : "negative"}`}
            >
              {tx.kind === "receive" ? "+" : "−"}
              {formatHns(tx.amount)} HNS
            </strong>
            <button type="button" className="link-button" onClick={() => void editMeta(tx)}>
              Edit
            </button>
          </article>
        ))}
        {items.length === 0 && <p className="empty-state">No transactions recorded yet.</p>}
      </div>

      {nextCursor && (
        <button type="button" className="button secondary" onClick={() => setCursor(nextCursor)}>
          Load more
        </button>
      )}
    </main>
  );
}
