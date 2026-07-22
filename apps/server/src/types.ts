import type { SessionRecord } from "./services/session-service.js";

export type AppEnv = {
  Variables: {
    session: SessionRecord | null;
  };
};
