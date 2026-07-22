import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { setup } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { useSession } from "../hooks/useSession.js";
import { rootRoute } from "./root.js";

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const setupMutation = useMutation({
    mutationFn: setup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
  });

  useEffect(() => {
    if (session.data?.setupComplete) {
      void navigate({ to: session.data.authenticated ? "/" : "/login" });
    }
  }, [session.data, navigate]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }
    if (password.length < 12) {
      setValidationError("Password must be at least 12 characters.");
      return;
    }
    setValidationError(null);
    setupMutation.mutate({ username, password });
  }

  const errorMessage =
    validationError ??
    (setupMutation.error instanceof ApiError ? setupMutation.error.message : null);

  return (
    <main className="page">
      <div className="card">
        <h1>Set up your admin account</h1>
        <p className="muted">This runs once. There is no separate sign-up flow.</p>
        {errorMessage && <div className="error-banner">{errorMessage}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              minLength={3}
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
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={setupMutation.isPending}>
            {setupMutation.isPending ? "Creating account…" : "Create admin account"}
          </button>
        </form>
      </div>
    </main>
  );
}
