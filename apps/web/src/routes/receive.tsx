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

      <div className="card">
        {current ? (
          <>
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt={`QR code for ${current.address}`}
                width={240}
                height={240}
              />
            )}
            <p className="muted">{current.address}</p>
            <div className="field-row">
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
          type="button"
          className="link-button"
          onClick={() => issueMutation.mutate()}
          disabled={issueMutation.isPending}
        >
          Generate a new address
        </button>
      </div>

      <h1>Previous addresses</h1>
      <ul>
        {addressesQuery.data?.map((entry) => (
          <li key={entry.address}>
            <code>{entry.address}</code> {entry.used ? "(used)" : "(unused)"}
            {entry.label ? ` — ${entry.label}` : ""}{" "}
            <button type="button" className="link-button" onClick={() => void labelAddress(entry)}>
              Label
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
