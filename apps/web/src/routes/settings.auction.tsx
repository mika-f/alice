import { createRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rootRoute } from "./root.js";
import { useSession } from "../hooks/useSession.js";
import {
  getRevealThresholds,
  getAutoRevealSettings,
  getAutoRedeemSettings,
  getAutoBidSettings,
  setAutoBidSettings,
  setAutoRevealSettings,
  setAutoRedeemSettings,
  setRevealThresholds,
} from "../api/notifications.js";
import { useEffect, useState } from "react";
import { formatHns, parseHnsToSmallestUnit } from "../lib/hns.js";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { SettingsPageHeader } from "../components/SettingsPageHeader.js";

export const auctionSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/auction",
  component: AuctionSettingsPage,
});

function AuctionSettingsPage() {
  const session = useSession();
  const queryClient = useQueryClient();

  const revealThresholdsQuery = useQuery({
    queryKey: ["reveal-thresholds"],
    queryFn: getRevealThresholds,
    enabled: session.data?.authenticated === true,
  });

  const autoRevealQuery = useQuery({
    queryKey: ["auto-reveal-settings"],
    queryFn: getAutoRevealSettings,
    enabled: session.data?.authenticated === true,
  });
  const autoRedeemQuery = useQuery({
    queryKey: ["auto-redeem-settings"],
    queryFn: getAutoRedeemSettings,
    enabled: session.data?.authenticated === true,
  });
  const autoBidQuery = useQuery({
    queryKey: ["auto-bid-settings"],
    queryFn: getAutoBidSettings,
    enabled: session.data?.authenticated === true,
  });

  const [revealBlocksRemaining, setRevealBlocksRemaining] = useState("");
  const [revealSaved, setRevealSaved] = useState(false);
  const [autoRevealEnabled, setAutoRevealEnabled] = useState(false);
  const [autoRevealPassphrase, setAutoRevealPassphrase] = useState("");
  const [autoRevealAdminPassword, setAutoRevealAdminPassword] = useState("");
  const [autoRevealSaved, setAutoRevealSaved] = useState(false);
  const [autoRedeemEnabled, setAutoRedeemEnabled] = useState(false);
  const [autoRedeemPassphrase, setAutoRedeemPassphrase] = useState("");
  const [autoRedeemAdminPassword, setAutoRedeemAdminPassword] = useState("");
  const [autoRedeemSaved, setAutoRedeemSaved] = useState(false);
  const [autoBidTiming, setAutoBidTiming] = useState<"next-block" | "before-reveal">("next-block");
  const [autoBidIncrement, setAutoBidIncrement] = useState("1");
  const [autoBidPassphrase, setAutoBidPassphrase] = useState("");
  const [autoBidAdminPassword, setAutoBidAdminPassword] = useState("");
  const [autoBidSaved, setAutoBidSaved] = useState(false);
  const [autoBidError, setAutoBidError] = useState<string | null>(null);

  useEffect(() => {
    if (revealThresholdsQuery.data) {
      setRevealBlocksRemaining(String(revealThresholdsQuery.data.blocksRemaining));
    }
  }, [revealThresholdsQuery.data]);

  useEffect(() => {
    if (autoRevealQuery.data) setAutoRevealEnabled(autoRevealQuery.data.enabled);
  }, [autoRevealQuery.data]);
  useEffect(() => {
    if (autoRedeemQuery.data) setAutoRedeemEnabled(autoRedeemQuery.data.enabled);
  }, [autoRedeemQuery.data]);
  useEffect(() => {
    if (!autoBidQuery.data) return;
    setAutoBidTiming(autoBidQuery.data.timing);
    setAutoBidIncrement(formatHns(autoBidQuery.data.increment));
  }, [autoBidQuery.data]);

  const saveRevealMutation = useMutation({
    mutationFn: () => setRevealThresholds({ blocksRemaining: Number(revealBlocksRemaining) }),
    onSuccess: () => {
      setRevealSaved(true);
      queryClient.invalidateQueries({ queryKey: ["reveal-thresholds"] });
    },
  });

  const saveAutoRevealMutation = useMutation({
    mutationFn: async () => {
      await reauth({ method: "password", password: autoRevealAdminPassword });
      return setAutoRevealSettings({
        enabled: autoRevealEnabled,
        passphrase: autoRevealPassphrase,
      });
    },
    onSuccess: () => {
      setAutoRevealPassphrase("");
      setAutoRevealAdminPassword("");
      setAutoRevealSaved(true);
      queryClient.invalidateQueries({ queryKey: ["auto-reveal-settings"] });
    },
  });
  const saveAutoRedeemMutation = useMutation({
    mutationFn: async () => {
      await reauth({ method: "password", password: autoRedeemAdminPassword });
      return setAutoRedeemSettings({
        enabled: autoRedeemEnabled,
        passphrase: autoRedeemPassphrase,
      });
    },
    onSuccess: () => {
      setAutoRedeemPassphrase("");
      setAutoRedeemAdminPassword("");
      setAutoRedeemSaved(true);
      queryClient.invalidateQueries({ queryKey: ["auto-redeem-settings"] });
    },
  });
  const saveAutoBidMutation = useMutation({
    mutationFn: async () => {
      await reauth({ method: "password", password: autoBidAdminPassword });
      return setAutoBidSettings({
        timing: autoBidTiming,
        increment: parseHnsToSmallestUnit(autoBidIncrement),
        passphrase: autoBidPassphrase,
      });
    },
    onSuccess: () => {
      setAutoBidPassphrase("");
      setAutoBidAdminPassword("");
      setAutoBidSaved(true);
      setAutoBidError(null);
      queryClient.invalidateQueries({ queryKey: ["auto-bid-settings"] });
    },
    onError: (err) => {
      setAutoBidSaved(false);
      setAutoBidError(
        err instanceof ApiError ? err.message : "Failed to save automatic bid settings",
      );
    },
  });

  return (
    <main className="dashboard">
      <SettingsPageHeader title="Auction Settings" />

      <p className="muted">These settings control the behavior of the auction system.</p>

      <section className="settings-section" aria-labelledby="reveal-threshold-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Auction protection</span>
            <h2 id="reveal-threshold-heading">Reveal deadline threshold</h2>
          </div>
        </div>
        <p className="muted">
          A name you've bid on is flagged once its reveal window closes within this many blocks.
          Missing the reveal window forfeits the entire locked-up bid, so keep this comfortably
          ahead of how often you check the wallet.
        </p>

        {revealSaved && <div className="success-banner">Saved.</div>}

        <form
          className="card settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            setRevealSaved(false);
            saveRevealMutation.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="reveal-threshold-blocks">Blocks remaining</label>
            <input
              id="reveal-threshold-blocks"
              type="number"
              min={1}
              required
              value={revealBlocksRemaining}
              onChange={(e) => setRevealBlocksRemaining(e.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={saveRevealMutation.isPending}>
            {saveRevealMutation.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="auto-reveal-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Auction protection</span>
            <h2 id="auto-reveal-heading">Automatic reveal</h2>
          </div>
        </div>
        <p className="muted">
          Automatically reveal every bid from this wallet as soon as its reveal period begins. Your
          wallet passphrase is encrypted at rest and used only to unlock the wallet for this action.
        </p>

        {autoRevealSaved && <div className="success-banner">Saved.</div>}

        <form
          className="card settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            setAutoRevealSaved(false);
            saveAutoRevealMutation.mutate();
          }}
        >
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoRevealEnabled}
              onChange={(e) => {
                setAutoRevealEnabled(e.target.checked);
                setAutoRevealSaved(false);
              }}
            />
            Automatically reveal bids
          </label>
          <div className="field">
            <label htmlFor="auto-reveal-passphrase">Wallet passphrase</label>
            <input
              id="auto-reveal-passphrase"
              type="password"
              autoComplete="new-password"
              value={autoRevealPassphrase}
              placeholder={
                autoRevealQuery.data?.passphraseConfigured
                  ? "Saved — enter a new value to replace it"
                  : "Leave empty only if your wallet has no passphrase"
              }
              onChange={(e) => setAutoRevealPassphrase(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auto-reveal-admin-password">Confirm with your app password</label>
            <input
              id="auto-reveal-admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={autoRevealAdminPassword}
              onChange={(e) => setAutoRevealAdminPassword(e.target.value)}
            />
          </div>
          <p className="muted">
            Disabling this feature removes any passphrase saved for automatic reveal.
          </p>
          <button type="submit" className="button" disabled={saveAutoRevealMutation.isPending}>
            {saveAutoRevealMutation.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </section>
      <section className="settings-section" aria-labelledby="auto-redeem-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Auction recovery</span>
            <h2 id="auto-redeem-heading">Automatic redeem</h2>
          </div>
        </div>
        <p className="muted">
          Automatically redeem losing revealed bids as soon as the auction closes. The winning
          reveal is left untouched, and hsd makes the final decision about which lockups can be
          redeemed.
        </p>

        {autoRedeemSaved && <div className="success-banner">Saved.</div>}

        <form
          className="card settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            setAutoRedeemSaved(false);
            saveAutoRedeemMutation.mutate();
          }}
        >
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoRedeemEnabled}
              onChange={(e) => {
                setAutoRedeemEnabled(e.target.checked);
                setAutoRedeemSaved(false);
              }}
            />
            Automatically redeem losing bids
          </label>
          <div className="field">
            <label htmlFor="auto-redeem-passphrase">Wallet passphrase</label>
            <input
              id="auto-redeem-passphrase"
              type="password"
              autoComplete="new-password"
              value={autoRedeemPassphrase}
              placeholder={
                autoRedeemQuery.data?.passphraseConfigured
                  ? "Saved — enter a new value to replace it"
                  : "Leave empty only if your wallet has no passphrase"
              }
              onChange={(e) => setAutoRedeemPassphrase(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auto-redeem-admin-password">Confirm with your app password</label>
            <input
              id="auto-redeem-admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={autoRedeemAdminPassword}
              onChange={(e) => setAutoRedeemAdminPassword(e.target.value)}
            />
          </div>
          <p className="muted">
            Disabling this feature removes its saved wallet passphrase and completion history.
          </p>
          <button type="submit" className="button" disabled={saveAutoRedeemMutation.isPending}>
            {saveAutoRedeemMutation.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </section>
      <section className="settings-section" aria-labelledby="auto-bid-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Auction protection</span>
            <h2 id="auto-bid-heading">Automatic competitive bidding</h2>
          </div>
        </div>
        <p className="muted">
          For auctions where this wallet has already placed a bid, watch for a new competing bid and
          submit one automatic bid. Set each name's timing and allowance from its name page; the
          timing below is the default for names that have not been configured individually.
        </p>
        {autoBidSaved && <div className="success-banner">Saved.</div>}
        {autoBidError && <div className="error-banner">{autoBidError}</div>}
        <form
          className="card settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            setAutoBidSaved(false);
            setAutoBidError(null);
            saveAutoBidMutation.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="auto-bid-timing">Default submit time</label>
            <select
              id="auto-bid-timing"
              value={autoBidTiming}
              onChange={(e) => setAutoBidTiming(e.target.value as "next-block" | "before-reveal")}
            >
              <option value="next-block">The next block</option>
              <option value="before-reveal">Two blocks before reveal</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="auto-bid-increment">Additional amount (HNS)</label>
            <input
              id="auto-bid-increment"
              type="number"
              min="0.000001"
              step="0.000001"
              required
              value={autoBidIncrement}
              onChange={(e) => setAutoBidIncrement(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auto-bid-passphrase">Wallet passphrase</label>
            <input
              id="auto-bid-passphrase"
              type="password"
              autoComplete="new-password"
              value={autoBidPassphrase}
              placeholder={
                autoBidQuery.data?.passphraseConfigured
                  ? "Saved — enter a new value to replace it"
                  : "Leave empty only if your wallet has no passphrase"
              }
              onChange={(e) => setAutoBidPassphrase(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auto-bid-admin-password">Confirm with your app password</label>
            <input
              id="auto-bid-admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={autoBidAdminPassword}
              onChange={(e) => setAutoBidAdminPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={saveAutoBidMutation.isPending}>
            {saveAutoBidMutation.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </section>
    </main>
  );
}
