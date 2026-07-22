import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getRenewalThresholds, setRenewalThresholds } from "../api/notifications.js";
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

  const [blocksRemaining, setBlocksRemaining] = useState("");
  const [daysRemaining, setDaysRemaining] = useState("");
  const [expirationRatio, setExpirationRatio] = useState("");
  const [saved, setSaved] = useState(false);

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
        className="card"
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
    </main>
  );
}
