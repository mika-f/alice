import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getRenewalThresholds,
  getAutoRevealSettings,
  getRevealThresholds,
  setAutoRevealSettings,
  setRenewalThresholds,
  setRevealThresholds,
} from "../api/notifications.js";
import { reauth } from "../api/auth.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const notificationSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/notifications",
  component: NotificationSettingsPage,
});

function NotificationSettingsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();

  const thresholdsQuery = useQuery({
    queryKey: ["renewal-thresholds"],
    queryFn: getRenewalThresholds,
    enabled: session.data?.authenticated === true,
  });

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

  const [blocksRemaining, setBlocksRemaining] = useState("");
  const [daysRemaining, setDaysRemaining] = useState("");
  const [expirationRatio, setExpirationRatio] = useState("");
  const [saved, setSaved] = useState(false);

  const [revealBlocksRemaining, setRevealBlocksRemaining] = useState("");
  const [revealSaved, setRevealSaved] = useState(false);
  const [autoRevealEnabled, setAutoRevealEnabled] = useState(false);
  const [autoRevealPassphrase, setAutoRevealPassphrase] = useState("");
  const [autoRevealAdminPassword, setAutoRevealAdminPassword] = useState("");
  const [autoRevealSaved, setAutoRevealSaved] = useState(false);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (thresholdsQuery.data) {
      setBlocksRemaining(String(thresholdsQuery.data.blocksRemaining));
      setDaysRemaining(String(thresholdsQuery.data.daysRemaining));
      setExpirationRatio(String(thresholdsQuery.data.expirationRatio));
    }
  }, [thresholdsQuery.data]);

  useEffect(() => {
    if (revealThresholdsQuery.data) {
      setRevealBlocksRemaining(String(revealThresholdsQuery.data.blocksRemaining));
    }
  }, [revealThresholdsQuery.data]);

  useEffect(() => {
    if (autoRevealQuery.data) setAutoRevealEnabled(autoRevealQuery.data.enabled);
  }, [autoRevealQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      setRenewalThresholds({
        blocksRemaining: Number(blocksRemaining),
        daysRemaining: Number(daysRemaining),
        expirationRatio: Number(expirationRatio),
      }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["renewal-thresholds"] });
    },
  });

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
      return setAutoRevealSettings({ enabled: autoRevealEnabled, passphrase: autoRevealPassphrase });
    },
    onSuccess: () => {
      setAutoRevealPassphrase("");
      setAutoRevealAdminPassword("");
      setAutoRevealSaved(true);
      queryClient.invalidateQueries({ queryKey: ["auto-reveal-settings"] });
    },
  });

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Renewal notification thresholds</h1>
        <Link to="/notifications">Back to notifications</Link>
      </div>

      <p className="muted">
        A name is flagged as approaching renewal once it crosses any one of these thresholds.
      </p>

      {saved && <div className="success-banner">Saved.</div>}

      <form
        className="card settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          saveMutation.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="threshold-blocks">Blocks remaining</label>
          <input
            id="threshold-blocks"
            type="number"
            min={1}
            required
            value={blocksRemaining}
            onChange={(e) => setBlocksRemaining(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="threshold-days">Estimated days remaining</label>
          <input
            id="threshold-days"
            type="number"
            min={1}
            step="any"
            required
            value={daysRemaining}
            onChange={(e) => setDaysRemaining(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="threshold-ratio">Fraction of renewal window remaining (0-1)</label>
          <input
            id="threshold-ratio"
            type="number"
            min={0}
            max={1}
            step="any"
            required
            value={expirationRatio}
            onChange={(e) => setExpirationRatio(e.target.value)}
          />
        </div>
        <button type="submit" className="button" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save"}
        </button>
      </form>

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
    </main>
  );
}
