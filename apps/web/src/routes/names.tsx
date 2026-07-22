import {
  classifyRenewal,
  estimateDaysRemaining,
  type RenewableName,
} from "@alice-hns-wallet/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import {
  listNames,
  renewNamesBatch,
  type NameActionResultResponse,
  type OwnedNameResponse,
} from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const namesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names",
  component: NamesPage,
});

const FILTERS = [
  "all",
  "owned",
  "renewal-recommended",
  "transferring",
  "finalizable",
  "expired",
  "revoked",
  "auction",
] as const;

type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  owned: "Owned",
  "renewal-recommended": "Renewal recommended",
  transferring: "Transfer in progress",
  finalizable: "Finalize available",
  expired: "Expired",
  revoked: "Revoked",
  auction: "Auction-related",
};

const SORTS = ["name", "state", "renewal", "expiration", "updated"] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABELS: Record<Sort, string> = {
  name: "Name",
  state: "State",
  renewal: "Renewal height",
  expiration: "Expiration height",
  updated: "Last updated",
};

const AUCTION_STATES = new Set(["opening", "bidding", "revealing", "closed"]);

function toRenewableName(item: OwnedNameResponse): RenewableName {
  return {
    state: item.state as RenewableName["state"],
    transferState: item.transferState as RenewableName["transferState"],
    blocksRemaining: item.blocksRemaining,
    renewalHeight: item.renewalHeight,
    expirationHeight: item.expirationHeight,
  };
}

function isRenewable(item: OwnedNameResponse): boolean {
  return classifyRenewal(toRenewableName(item)) !== "not-renewable";
}

function matchesFilter(item: OwnedNameResponse, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "owned":
      return item.owned;
    case "renewal-recommended": {
      const category = classifyRenewal(toRenewableName(item));
      return category === "recommended" || category === "imminent";
    }
    case "transferring":
      return item.transferState === "pending";
    case "finalizable":
      return item.transferState === "finalizable";
    case "expired":
      return item.state === "expired";
    case "revoked":
      return item.state === "revoked";
    case "auction":
      return AUCTION_STATES.has(item.state);
  }
}

function matchesSearch(item: OwnedNameResponse, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    (item.label?.toLowerCase().includes(q) ?? false) ||
    (item.memo?.toLowerCase().includes(q) ?? false)
  );
}

function compareBySort(a: OwnedNameResponse, b: OwnedNameResponse, sort: Sort): number {
  switch (sort) {
    case "name":
      return a.name.localeCompare(b.name);
    case "state":
      return a.state.localeCompare(b.state);
    case "renewal":
      return a.renewalHeight - b.renewalHeight;
    case "expiration":
      return a.expirationHeight - b.expirationHeight;
    case "updated":
      return b.updatedAt - a.updatedAt;
  }
}

function formatRemaining(blocks: number): string {
  if (blocks <= 0) return "—";
  const days = estimateDaysRemaining(blocks);
  return days >= 1 ? `${blocks} blocks (~${days.toFixed(1)}d)` : `${blocks} blocks`;
}

function NamesPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchResults, setBatchResults] = useState<NameActionResultResponse[] | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [pendingBatch, setPendingBatch] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const namesQuery = useQuery({
    queryKey: ["names"],
    queryFn: listNames,
    enabled: session.data?.authenticated === true,
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const visible = useMemo(() => {
    const items = namesQuery.data ?? [];
    return items
      .filter((item) => matchesFilter(item, filter))
      .filter((item) => matchesSearch(item, query))
      .sort((a, b) => compareBySort(a, b, sort));
  }, [namesQuery.data, filter, sort, query]);

  const renewableNames = useMemo(
    () => (namesQuery.data ?? []).filter(isRenewable).map((n) => n.name),
    [namesQuery.data],
  );

  const batchMutation = useMutation({
    mutationFn: (names: string[]) => renewNamesBatch(names),
    onSuccess: (results) => {
      setBatchResults(results);
      setNeedsReauth(false);
      setBatchError(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["names"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsReauth(true);
      } else if (err instanceof ApiError) {
        setBatchError(err.message);
      }
    },
  });

  const reauthMutation = useMutation({
    mutationFn: () => reauth({ method: "password", password: reauthPassword }),
    onSuccess: () => {
      setNeedsReauth(false);
      setReauthPassword("");
      batchMutation.mutate(pendingBatch);
    },
  });

  function startBatch(names: string[]) {
    setPendingBatch(names);
    setBatchResults(null);
    batchMutation.mutate(names);
  }

  function toggleSelected(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Names</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <div className="field">
        <label htmlFor="name-search">Search</label>
        <input
          id="name-search"
          type="search"
          placeholder="Name, label, or memo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="field-row" style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? "button" : "button secondary"}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="name-sort">Sort by</label>
        <select id="name-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {namesQuery.isLoading && <p className="muted">Loading names…</p>}
      {namesQuery.data && namesQuery.data.length === 0 && (
        <p className="muted">No names known to this wallet yet.</p>
      )}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">Batch renewal requires re-authentication.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reauthMutation.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="batch-reauth-password">Password</label>
              <input
                id="batch-reauth-password"
                type="password"
                autoComplete="current-password"
                required
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="button" disabled={reauthMutation.isPending}>
              Confirm and renew
            </button>
          </form>
        </div>
      )}

      {batchError && <div className="error-banner">{batchError}</div>}

      {batchResults && (
        <div className="card">
          <h1>Renewal results</h1>
          <ul>
            {batchResults.map((r) => (
              <li key={r.name}>
                {r.name}/{" "}
                {r.status === "success"
                  ? "Success"
                  : `${r.status === "failed" ? "Failed" : "Skipped"}: ${r.reason ?? ""}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field-row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="button secondary"
          disabled={selected.size === 0 || batchMutation.isPending}
          onClick={() => startBatch(Array.from(selected))}
        >
          Renew selected ({selected.size})
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={renewableNames.length === 0 || batchMutation.isPending}
          onClick={() => startBatch(renewableNames)}
        >
          Renew all renewable ({renewableNames.length})
        </button>
      </div>

      <ul>
        {visible.map((item) => (
          <li key={item.name}>
            {isRenewable(item) && (
              <input
                type="checkbox"
                checked={selected.has(item.name)}
                onChange={() => toggleSelected(item.name)}
                aria-label={`Select ${item.name} for batch renewal`}
              />
            )}{" "}
            <Link to="/names/$name" params={{ name: item.name }}>
              <strong>{item.name}</strong>
            </Link>{" "}
            — {item.state}
            {item.owned ? " (owned)" : ""}
            {item.transferState !== "none" && ` · transfer: ${item.transferState}`}
            <br />
            <span className="muted">
              Renewal @{item.renewalHeight || "—"} · Expiration @{item.expirationHeight || "—"} ·{" "}
              {formatRemaining(item.blocksRemaining)}
            </span>
            {item.resourceSummary && <span className="muted"> · {item.resourceSummary}</span>}
            {item.label && <span> — {item.label}</span>}
            {item.memo && <span className="muted"> ({item.memo})</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
