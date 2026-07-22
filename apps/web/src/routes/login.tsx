import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { login, loginTotp } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      if (result.totpRequired) {
        setTotpRequired(true);
      } else {
        queryClient.invalidateQueries({ queryKey: ["session"] });
        void navigate({ to: "/" });
      }
    },
  });

  const totpMutation = useMutation({
    mutationFn: loginTotp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
  });

  useEffect(() => {
    if (session.data?.setupComplete === false) {
      void navigate({ to: "/setup" });
    } else if (session.data?.authenticated) {
      void navigate({ to: "/" });
    }
  }, [session.data, navigate]);

  const error = loginMutation.error ?? totpMutation.error;
  const errorMessage = error instanceof ApiError ? error.message : null;

  if (totpRequired) {
    return (
      <main className="page">
        <div className="card">
          <h1>Two-factor code</h1>
          <p className="muted">Enter your 6-digit code, or a recovery code.</p>
          {errorMessage && <div className="error-banner">{errorMessage}</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              totpMutation.mutate({ code });
            }}
          >
            <div className="field">
              <label htmlFor="code">Code</label>
              <input
                id="code"
                name="code"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <button type="submit" className="button" disabled={totpMutation.isPending}>
              {totpMutation.isPending ? "Verifying…" : "Verify"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <h1>Handshake Web Wallet</h1>
        {errorMessage && <div className="error-banner">{errorMessage}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loginMutation.mutate({ username, password });
          }}
        >
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
