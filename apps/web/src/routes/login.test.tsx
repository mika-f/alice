import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardRoute } from "./dashboard.js";
import { loginRoute } from "./login.js";
import { rootRoute } from "./root.js";
import { setupRoute } from "./setup.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildTestRouter() {
  const routeTree = rootRoute.addChildren([dashboardRoute, setupRoute, loginRoute]);
  const history = createMemoryHistory({ initialEntries: ["/login"] });
  return createRouter({ routeTree, history });
}

describe("LoginPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("logs in directly when TOTP is not enabled", async () => {
    let authenticated = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return jsonResponse({ authenticated, setupComplete: true, pendingTotp: false });
      }
      if (url.endsWith("/api/auth/login") && init?.method === "POST") {
        authenticated = true;
        return jsonResponse({ totpRequired: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const router = buildTestRouter();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Handshake Web Wallet" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("prompts for a TOTP code as a second step when required", async () => {
    let step: "password" | "totp" | "done" = "password";

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return jsonResponse({
          authenticated: step === "done",
          setupComplete: true,
          pendingTotp: step === "totp",
        });
      }
      if (url.endsWith("/api/auth/login") && init?.method === "POST") {
        step = "totp";
        return jsonResponse({ totpRequired: true });
      }
      if (url.endsWith("/api/auth/login/totp") && init?.method === "POST") {
        step = "done";
        return jsonResponse({ authenticated: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const router = buildTestRouter();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Handshake Web Wallet" });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("heading", { name: "Two-factor code" });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });
});
