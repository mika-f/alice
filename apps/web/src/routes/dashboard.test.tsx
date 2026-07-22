import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dashboardRoute } from "./dashboard.js";
import { rootRoute } from "./root.js";

describe("DashboardPage", () => {
  it("renders the wallet heading", async () => {
    const routeTree = rootRoute.addChildren([dashboardRoute]);
    const router = createRouter({ routeTree });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Handshake Web Wallet" }),
    ).toBeInTheDocument();
  });
});
