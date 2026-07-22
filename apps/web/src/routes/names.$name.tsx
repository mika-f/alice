import { estimateDaysRemaining } from "@alice-hns-wallet/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { getName, setNameMeta } from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import { describeRecord } from "../lib/dns-records.js";
import { formatHns } from "../lib/hns.js";
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

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>{name}</h1>
        <Link to="/names">Back to names</Link>
      </div>

      {detailQuery.isLoading && <p className="muted">Loading…</p>}
      {detailQuery.isError && <div className="error-banner">Could not load this name.</div>}

      {detail && (
        <>
          <div className="card">
            <h1>Basic info</h1>
            <p>
              <strong>State:</strong> {detail.state}
              {detail.owned ? " (owned by this wallet)" : ""}
            </p>
            <p>
              <strong>Name hash:</strong> <code>{detail.nameHash}</code>
            </p>
            <p>
              <strong>Owner address:</strong> {detail.ownerAddress ?? "—"}
            </p>
            <p>
              <strong>Block height:</strong> {detail.blockHeight}
            </p>
            <p>
              <strong>Renewal height:</strong> {detail.renewalHeight || "—"} ·{" "}
              <strong>Expiration height:</strong> {detail.expirationHeight || "—"}
            </p>
            <p>
              <strong>Blocks remaining:</strong> {detail.blocksRemaining}
              {detail.blocksRemaining > 0 &&
                ` (~${estimateDaysRemaining(detail.blocksRemaining).toFixed(1)} days)`}
            </p>
            <p>
              <strong>Transfer state:</strong> {detail.transferState}
            </p>
            <p>
              <strong>Label:</strong> {detail.label ?? "—"} · <strong>Memo:</strong>{" "}
              {detail.memo ?? "—"}{" "}
              <button type="button" className="link-button" onClick={editMeta}>
                Edit
              </button>
            </p>
          </div>

          {detail.owned && (
            <div className="card">
              <h1>Actions</h1>
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
            </div>
          )}

          <div className="card">
            <h1>DNS resource</h1>
            {detail.resource ? (
              <>
                <ul>
                  {detail.resource.records.map((record, i) => (
                    <li key={i}>{describeRecord(record)}</li>
                  ))}
                </ul>
                <p className="muted">
                  Raw ({detail.resource.size} bytes): <code>{detail.resource.raw}</code>
                </p>
              </>
            ) : (
              <p className="muted">No DNS resource set.</p>
            )}
          </div>

          {(detail.bids.length > 0 || detail.reveals.length > 0) && (
            <div className="card">
              <h1>Auction history</h1>
              {detail.bids.length > 0 && (
                <>
                  <p>
                    <strong>Bids</strong>
                  </p>
                  <ul>
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
                  <ul>
                    {detail.reveals.map((reveal, i) => (
                      <li key={i}>
                        {reveal.own ? "You" : "Someone"} bid {formatHns(reveal.value)} HNS at height{" "}
                        {reveal.height}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
