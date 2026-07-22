import { createRouter } from "@tanstack/react-router";
import { connectionSettingsRoute } from "./routes/settings.connection.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { loginRoute } from "./routes/login.js";
import { rootRoute } from "./routes/root.js";
import { setupRoute } from "./routes/setup.js";

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  setupRoute,
  loginRoute,
  connectionSettingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
