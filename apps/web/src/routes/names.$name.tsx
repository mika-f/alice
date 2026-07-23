import { estimateDaysRemaining } from "@alice-hns-wallet/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { getName, setNameMeta } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { describeRecord } from "../lib/dns-records.js";
import { formatHns } from "../lib/hns.js";
import { shakeshiftBlockUrl, shakeshiftNameUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name",
  component: NameDetailPage,
});

function NameDetailPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameDetailRoute.id });

  const detailQuery = useQuery({
    queryKey: ["name", name],
    queryFn: () => getName(name),
    enabled: session.data?.authenticated === true,
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const metaMutation = useMutation({
    mutationFn: (input: { label?: string; memo?: string }) => setNameMeta(name, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["name", name] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
    },
  });

  function editMeta() {
    if (!detailQuery.data) return;
    const label = window.prompt("Label", detailQuery.data.label ?? "") ?? undefined;
    const memo = window.prompt("Memo", detailQuery.data.memo ?? "") ?? undefined;
    metaMutation.mutate({ label, memo });
  }

  const detail = detailQuery.data;
  const hasOwnBid = detail?.bids.some((b) => b.own) ?? false;
  const hasOwnReveal = detail?.reveals.some((r) => r.own) ?? false;
  const canBid = detail && (detail.state === "opening" || detail.state === "bidding");
  const canReveal = detail && detail.state === "revealing" && hasOwnBid && !hasOwnReveal;
  const canRedeem = detail && detail.state === "closed" && hasOwnReveal;
  // hsd tracks ownership of the winning coin as soon as an auction closes, before the winner has
  // ever called REGISTER — `owned` alone doesn't imply "already registered" while state stays
  // "closed" (that only flips to "owned" once a REGISTER/UPDATE tx has landed).
  const canRegister = detail && detail.state === "closed" && detail.owned && hasOwnReveal;

  return (
    <main className="dashboard">
      <div className="name-detail-header">
        <div>
          <Link to="/names" className="back-link">
            ← All names
          </Link>
          <div className="name-title-row">
            <h1>{name}</h1>
            {detail && (
              <span className={`status-badge name-state-${detail.state}`}>{detail.state}</span>
            )}
          </div>
          {detail?.label && <p className="name-detail-label">{detail.label}</p>}
        </div>
        <a
          className="button secondary name-explorer-link"
          href={shakeshiftNameUrl(name)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Shakeshift ↗
        </a>
      </div>

      {detailQuery.isLoading && <p className="muted">Loading…</p>}
      {detailQuery.isError && <div className="error-banner">Could not load this name.</div>}

      {detail && (
        <>
          <section className="card name-overview-card" aria-labelledby="name-overview-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Name overview</span>
                <h2 id="name-overview-heading">Registration details</h2>
              </div>
              {detail.owned && <span className="status-badge status-badge-success">Owned</span>}
            </div>
            <dl className="name-detail-grid">
              <div>
                <dt>Blocks remaining</dt>
                <dd>
                  {detail.blocksRemaining || "—"}
                  {detail.blocksRemaining > 0 && (
                    <small>~{estimateDaysRemaining(detail.blocksRemaining).toFixed(1)} days</small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Transfer</dt>
                <dd className="detail-capitalized">{detail.transferState}</dd>
              </div>
              <div>
                <dt>Renewal height</dt>
                <dd>{detail.renewalHeight || "—"}</dd>
              </div>
              <div>
                <dt>Expiration height</dt>
                <dd>{detail.expirationHeight || "—"}</dd>
              </div>
              <div>
                <dt>Registered in block</dt>
                <dd>
                  <a
                    href={shakeshiftBlockUrl(detail.blockHeight)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {detail.blockHeight} ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt>Owner address</dt>
                <dd><code>{detail.ownerAddress ?? "—"}</code></dd>
              </div>
              <div className="name-detail-wide">
                <dt>Name hash</dt>
                <dd><code>{detail.nameHash}</code></dd>
              </div>
            </dl>
            <div className="name-notes">
              <div>
                <span className="eyebrow">Wallet note</span>
                <p>{detail.memo ?? "Add a private note to help identify this name."}</p>
              </div>
              <button type="button" className="link-button" onClick={editMeta}>
                Edit label & note
              </button>
            </div>
          </section>

          {detail.owned && detail.state !== "closed" && (
            <section className="card name-actions-card" aria-labelledby="name-actions-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Manage name</span>
                  <h2 id="name-actions-heading">Actions</h2>
                </div>
              </div>
              <div className="field-row" style={{ flexWrap: "wrap" }}>
                <Link to="/names/$name/edit" params={{ name }} className="button secondary">
                  Edit DNS records
                </Link>
                <Link to="/names/$name/renew" params={{ name }} className="button secondary">
                  Renew
                </Link>
                {detail.transferState === "none" && (
                  <Link to="/names/$name/transfer" params={{ name }} className="button secondary">
                    Transfer
                  </Link>
                )}
                {detail.transferState === "finalizable" && (
                  <Link to="/names/$name/finalize" params={{ name }} className="button secondary">
                    Finalize transfer
                  </Link>
                )}
                <Link to="/names/$name/revoke" params={{ name }} className="button danger">
                  Revoke
                </Link>
              </div>
            </section>
          )}

          {(canBid || canReveal || canRedeem || canRegister) && (
            <section className="card name-actions-card" aria-labelledby="auction-actions-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Auction</span>
                  <h2 id="auction-actions-heading">Available action</h2>
                </div>
              </div>
              <div className="field-row" style={{ flexWrap: "wrap" }}>
                {canBid && (
                  <Link to="/names/$name/bid" params={{ name }} className="button secondary">
                    Place bid
                  </Link>
                )}
                {canReveal && (
                  <Link to="/names/$name/reveal" params={{ name }} className="button">
                    Reveal bid
                  </Link>
                )}
                {canRegister && (
                  <Link to="/names/$name/edit" params={{ name }} className="button">
                    Register
                  </Link>
                )}
                {canRedeem && (
                  <Link to="/names/$name/redeem" params={{ name }} className="button secondary">
                    Redeem
                  </Link>
                )}
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="dns-resource-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">On-chain records</span>
                <h2 id="dns-resource-heading">DNS resource</h2>
              </div>
              {detail.resource && <span className="status-badge status-badge-muted">{detail.resource.size} bytes</span>}
            </div>
            {detail.resource ? (
              <>
                <ul className="dns-record-list">
                  {detail.resource.records.map((record, i) => (
                    <li key={i}>
                      <span className="dns-record-number">{String(i + 1).padStart(2, "0")}</span>
                      <code>{describeRecord(record)}</code>
                    </li>
                  ))}
                </ul>
                <p className="raw-resource muted">
                  Raw resource: <code>{detail.resource.raw}</code>
                </p>
              </>
            ) : (
              <p className="muted">No DNS resource set.</p>
            )}
          </section>

          {(detail.bids.length > 0 || detail.reveals.length > 0) && (
            <section className="card" aria-labelledby="auction-history-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Auction</span>
                  <h2 id="auction-history-heading">History</h2>
                </div>
              </div>
              {detail.bids.length > 0 && (
                <>
                  <p>
                    <strong>Bids</strong>
                  </p>
                  <ul className="auction-history-list">
                    {detail.bids.map((bid, i) => (
                      <li key={i}>
                        {bid.own ? "You" : "Someone"} locked up {formatHns(bid.lockup)} HNS at
                        height {bid.height}
                        {bid.value !== null && ` (bid ${formatHns(bid.value)} HNS)`}
                        {bid.value === null && " (bid amount hidden until reveal)"}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.reveals.length > 0 && (
                <>
                  <p>
                    <strong>Reveals</strong>
                  </p>
                  <ul className="auction-history-list">
                    {detail.reveals.map((reveal, i) => (
                      <li key={i}>
                        {reveal.own ? "You" : "Someone"} bid {formatHns(reveal.value)} HNS at height{" "}
                        {reveal.height}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
