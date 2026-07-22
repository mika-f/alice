import { createRouter } from "@tanstack/react-router";
import { auditLogRoute } from "./routes/settings.audit-log.js";
import { connectionSettingsRoute } from "./routes/settings.connection.js";
import { diagnosticsRoute } from "./routes/settings.diagnostics.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { importWalletRoute } from "./routes/settings.import-wallet.js";
import { loginRoute } from "./routes/login.js";
import { nameDetailRoute } from "./routes/names.$name.js";
import { nameEditRoute } from "./routes/names.$name.edit.js";
import { nameFinalizeRoute } from "./routes/names.$name.finalize.js";
import { nameRenewRoute } from "./routes/names.$name.renew.js";
import { nameRevokeRoute } from "./routes/names.$name.revoke.js";
import { nameTransferRoute } from "./routes/names.$name.transfer.js";
import { namesRoute } from "./routes/names.js";
import { notificationSettingsRoute } from "./routes/settings.notifications.js";
import { notificationsRoute } from "./routes/notifications.js";
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
  nameEditRoute,
  nameRenewRoute,
  nameTransferRoute,
  nameFinalizeRoute,
  nameRevokeRoute,
  notificationsRoute,
  notificationSettingsRoute,
  auditLogRoute,
  diagnosticsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
