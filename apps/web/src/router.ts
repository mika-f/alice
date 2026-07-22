import { createRouter } from "@tanstack/react-router";
import { dashboardRoute } from "./routes/dashboard.js";
import { rootRoute } from "./routes/root.js";

const routeTree = rootRoute.addChildren([dashboardRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
