import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <main>
      <h1>Handshake Web Wallet</h1>
      <p>Dashboard is not implemented yet.</p>
    </main>
  );
}
