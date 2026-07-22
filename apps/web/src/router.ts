import { createRouter } from "@tanstack/react-router";
import { connectionSettingsRoute } from "./routes/settings.connection.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { importWalletRoute } from "./routes/settings.import-wallet.js";
import { loginRoute } from "./routes/login.js";
import { nameDetailRoute } from "./routes/names.$name.js";
import { namesRoute } from "./routes/names.js";
import { receiveRoute } from "./routes/receive.js";
import { rootRoute } from "./routes/root.js";
import { sendRoute } from "./routes/send.js";
import { setupRoute } from "./routes/setup.js";
import { transactionsRoute } from "./routes/transactions.js";

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  setupRoute,
  loginRoute,
  connectionSettingsRoute,
  importWalletRoute,
  receiveRoute,
  sendRoute,
  transactionsRoute,
  namesRoute,
  nameDetailRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
