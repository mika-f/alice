import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand" aria-label="Alice dashboard">
          <span className="brand-mark">A</span>
          <span>
            <strong>Alice</strong>
            <small>Handshake wallet</small>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Primary navigation">
          <Link to="/" activeProps={{ className: "active" }}>
            Overview
          </Link>
          <Link to="/names" activeProps={{ className: "active" }}>
            Names
          </Link>
          <Link to="/transactions" activeProps={{ className: "active" }}>
            Activity
          </Link>
          <Link to="/settings/connection" activeProps={{ className: "active" }}>
            Settings
          </Link>
        </nav>
        <div className="network-pill">
          <span className="online-dot" /> HNS wallet
        </div>
      </header>
      <Outlet />
    </div>
  ),
});
