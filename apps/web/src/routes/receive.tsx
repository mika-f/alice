import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  issueReceiveAddress,
  listAddresses,
  setAddressLabel,
  type AddressHistoryEntry,
} from "../api/wallet.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const receiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/receive",
  component: ReceivePage,
});

function useQrDataUrl(address: string | undefined) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(address, { width: 240 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return dataUrl;
}

function ReceivePage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const addressesQuery = useQuery({ queryKey: ["addresses"], queryFn: listAddresses });
  const issueMutation = useMutation({
    mutationFn: issueReceiveAddress,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses"] });
    },
  });

  const current = addressesQuery.data?.[0];
  const qrDataUrl = useQrDataUrl(current?.address);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (addressesQuery.data && addressesQuery.data.length === 0) {
      issueMutation.mutate();
    }
  }, [addressesQuery.data]);

  async function copyAddress() {
    if (!current) return;
    await navigator.clipboard.writeText(current.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareAddress() {
    if (!current) return;
    if (navigator.share) {
      await navigator.share({ text: current.address });
    } else {
      await copyAddress();
    }
  }

  async function labelAddress(entry: AddressHistoryEntry) {
    const label = window.prompt("Label for this address", entry.label ?? "");
    if (label === null) return;
    await setAddressLabel(entry.address, label || null);
    queryClient.invalidateQueries({ queryKey: ["addresses"] });
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Receive HNS</h1>
        <Link to="/">Back to dashboard</Link>
      </div>

      <div className="card receive-card">
        {current ? (
          <>
            <div className="receive-card-heading">
              <div>
                <span className="eyebrow">Your active address</span>
                <h2>Ready to receive</h2>
              </div>
              <span className="status-badge status-badge-success">Active</span>
            </div>
            <div className="qr-frame">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${current.address}`}
                  width={240}
                  height={240}
                />
              )}
            </div>
            <p className="address-display">{current.address}</p>
            <div className="field-row receive-actions">
              <button type="button" className="button secondary" onClick={() => void copyAddress()}>
                {copied ? "Copied!" : "Copy address"}
              </button>
              <button type="button" className="button" onClick={() => void shareAddress()}>
                Share
              </button>
            </div>
          </>
        ) : (
          <p>Issuing a receive address…</p>
        )}
        <button
          className="generate-address"
          type="button"
          onClick={() => issueMutation.mutate()}
          disabled={issueMutation.isPending}
        >
          Generate a new address
        </button>
      </div>

      <div className="section-heading">
        <div>
          <span className="eyebrow">Address book</span>
          <h2>Previous addresses</h2>
        </div>
        <span className="muted">{addressesQuery.data?.length ?? 0} total</span>
      </div>
      <ul className="address-list">
        {addressesQuery.data?.map((entry) => (
          <li key={entry.address}>
            <div className="address-list-main">
              <span className={`address-dot ${entry.used ? "used" : ""}`} />
              <div>
                <code>{entry.address}</code>
                <span className="muted">{entry.label || "Unlabeled address"}</span>
              </div>
            </div>
            <div className="address-list-meta">
              <span
                className={`status-badge ${entry.used ? "status-badge-muted" : "status-badge-success"}`}
              >
                {entry.used ? "Used" : "Unused"}
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => void labelAddress(entry)}
              >
                Edit label
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
