import { estimateDaysRemaining } from "@alice-hns-wallet/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { getName, setNameMeta, type DnsRecordResponse } from "../api/names.js";
import { formatHns } from "../lib/hns.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const nameDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name",
  component: NameDetailPage,
});

function describeRecord(record: DnsRecordResponse): string {
  switch (record.type) {
    case "NS":
      return `NS ${record.ns}`;
    case "GLUE4":
      return `GLUE4 ${record.ns} → ${record.address}`;
    case "GLUE6":
      return `GLUE6 ${record.ns} → ${record.address}`;
    case "DS":
      return `DS keyTag=${record.keyTag} alg=${record.algorithm} digestType=${record.digestType} digest=${record.digest}`;
    case "TXT":
      return `TXT ${record.text.join(" ")}`;
    case "SYNTH4":
      return `SYNTH4 ${record.address}`;
    case "SYNTH6":
      return `SYNTH6 ${record.address}`;
    case "UNKNOWN":
      return `Unrecognized record: ${record.raw}`;
  }
}

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
