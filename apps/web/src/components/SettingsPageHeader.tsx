import { Link } from "@tanstack/react-router";

const settingsTabs = [
  { to: "/settings/connection", label: "Connection" },
  { to: "/settings/import-wallet", label: "Restore wallet" },
  { to: "/settings/auction", label: "Auction" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/external-notifications", label: "External alerts" },
  { to: "/settings/diagnostics", label: "Diagnostics" },
  { to: "/settings/audit-log", label: "Audit log" },
] as const;

type SettingsPageHeaderProps = {
  title: string;
};

export function SettingsPageHeader({ title }: SettingsPageHeaderProps) {
  return (
    <>
      <div className="dashboard-header settings-page-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h1>{title}</h1>
        </div>
        <Link to="/">Back to dashboard</Link>
      </div>
      <nav className="settings-tabs" aria-label="Settings navigation">
        {settingsTabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: true }}
            activeProps={{ className: "active" }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
