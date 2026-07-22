import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { listNotifications, markNotificationRead } from "../api/notifications.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationsPage,
});

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function NotificationsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    enabled: session.data?.authenticated === true,
  });

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  const readMutation = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = notificationsQuery.data ?? [];

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Notifications</h1>
        <div className="field-row">
          <Link to="/settings/notifications">Thresholds</Link>
          <Link to="/">Back to dashboard</Link>
        </div>
      </div>

      {notificationsQuery.isLoading && <p className="muted">Loading…</p>}
      {notifications.length === 0 && !notificationsQuery.isLoading && (
        <p className="muted">No notifications yet.</p>
      )}

      <ul>
        {notifications.map((n) => (
          <li key={n.id} style={{ opacity: n.readAt ? 0.6 : 1 }}>
            <strong>{n.type}</strong>
            {n.name && (
              <>
                {" "}
                —{" "}
                <Link to="/names/$name" params={{ name: n.name }}>
                  {n.name}
                </Link>
              </>
            )}
            <br />
            {n.message}
            <br />
            <span className="muted">{formatTimestamp(n.createdAt)}</span>
            {!n.readAt && (
              <>
                {" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => readMutation.mutate(n.id)}
                >
                  Mark read
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
