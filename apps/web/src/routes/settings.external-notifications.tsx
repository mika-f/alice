import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getExternalNotificationSettings,
  sendTestExternalNotification,
  setExternalNotificationSettings,
} from "../api/external-notifications.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const externalNotificationSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/external-notifications",
  component: ExternalNotificationSettingsPage,
});

function ExternalNotificationSettingsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["external-notification-settings"],
    queryFn: getExternalNotificationSettings,
    enabled: session.data?.authenticated === true,
  });

  const [ntfyEnabled, setNtfyEnabled] = useState(false);
  const [ntfyUrl, setNtfyUrl] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordUrl, setDiscordUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ntfy: boolean | null;
    discord: boolean | null;
  } | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (query.data) {
      setNtfyEnabled(query.data.ntfy.enabled);
      setDiscordEnabled(query.data.discord.enabled);
    }
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      setExternalNotificationSettings({
        ntfy: { enabled: ntfyEnabled, url: ntfyUrl },
        discord: { enabled: discordEnabled, url: discordUrl },
      }),
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      setNtfyUrl("");
      setDiscordUrl("");
      queryClient.invalidateQueries({ queryKey: ["external-notification-settings"] });
    },
    onError: (error: unknown) => {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    },
  });

  const testMutation = useMutation({
    mutationFn: sendTestExternalNotification,
    onSuccess: setTestResult,
  });

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>External notifications</h1>
        <Link to="/notifications">Back to notifications</Link>
      </div>

      <p className="muted">
        Sends the same short message shown in-app to the channels below. Never includes your seed,
        private key, wallet password, API keys, full balance, or raw internal error details.
      </p>

      {saved && <div className="success-banner">Saved.</div>}
      {saveError && <div className="error-banner">{saveError}</div>}
      {testResult && (
        <div className="success-banner">
          {testResult.ntfy !== null && <div>ntfy: {testResult.ntfy ? "sent" : "failed"}</div>}
          {testResult.discord !== null && (
            <div>Discord: {testResult.discord ? "sent" : "failed"}</div>
          )}
          {testResult.ntfy === null && testResult.discord === null && (
            <div>No channel is enabled.</div>
          )}
        </div>
      )}

      <form
        className="card settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          setTestResult(null);
          saveMutation.mutate();
        }}
      >
        <h1>ntfy</h1>
        <div className="field">
          <label htmlFor="ntfy-enabled">
            <input
              id="ntfy-enabled"
              type="checkbox"
              checked={ntfyEnabled}
              onChange={(e) => setNtfyEnabled(e.target.checked)}
            />{" "}
            Enabled
          </label>
        </div>
        <div className="field">
          <label htmlFor="ntfy-url">
            Topic URL{" "}
            {query.data?.ntfy.configured && (
              <span className="muted">(configured — leave blank to keep it)</span>
            )}
          </label>
          <input
            id="ntfy-url"
            type="url"
            placeholder="https://ntfy.sh/my-topic"
            value={ntfyUrl}
            onChange={(e) => setNtfyUrl(e.target.value)}
          />
        </div>

        <h1>Discord webhook</h1>
        <div className="field">
          <label htmlFor="discord-enabled">
            <input
              id="discord-enabled"
              type="checkbox"
              checked={discordEnabled}
              onChange={(e) => setDiscordEnabled(e.target.checked)}
            />{" "}
            Enabled
          </label>
        </div>
        <div className="field">
          <label htmlFor="discord-url">
            Webhook URL{" "}
            {query.data?.discord.configured && (
              <span className="muted">(configured — leave blank to keep it)</span>
            )}
          </label>
          <input
            id="discord-url"
            type="url"
            placeholder="https://discord.com/api/webhooks/…"
            value={discordUrl}
            onChange={(e) => setDiscordUrl(e.target.value)}
          />
        </div>

        <div className="field-row">
          <button type="submit" className="button" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? "Sending…" : "Send test notification"}
          </button>
        </div>
      </form>
    </main>
  );
}
