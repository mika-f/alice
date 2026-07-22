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
  const history = createMemoryHistory({ initialEntries: ["/setup"] });
  return createRouter({ routeTree, history });
}

describe("SetupPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("submits the form and navigates to the dashboard on success", async () => {
    let setupComplete = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return jsonResponse({
          authenticated: setupComplete,
          setupComplete,
          pendingTotp: false,
        });
      }
      if (url.endsWith("/api/auth/setup") && init?.method === "POST") {
        setupComplete = true;
        return jsonResponse({ username: "alice" });
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

    await screen.findByRole("heading", { name: "Set up your admin account" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create admin account" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/setup",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("shows a validation error when passwords don't match", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ authenticated: false, setupComplete: false, pendingTotp: false }),
    );

    const router = buildTestRouter();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Set up your admin account" });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery-staple" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "something-else-entirely" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create admin account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/auth/setup",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
