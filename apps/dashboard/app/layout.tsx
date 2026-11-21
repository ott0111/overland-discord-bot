import React from "react";
import "./globals.css";
export const metadata = { title: "Overland Core Admin", description: "Administration dashboard for Overland Finance" };
const NAV = [
  { href: "/", label: "Overview" },
  { href: "/members", label: "Members" },
  { href: "/roles", label: "Public Roles" },
  { href: "/team", label: "Internal Team" },
  { href: "/permissions", label: "Permissions" },
  { href: "/x", label: "X Integration" },
  { href: "/welcome", label: "Welcome and Verification" },
  { href: "/moderation", label: "Moderation and Security" },
  { href: "/tickets", label: "Tickets" },
  { href: "/points", label: "Points and Economy" },
  { href: "/campaigns", label: "Social Campaigns" },
  { href: "/referrals", label: "Referrals" },
  { href: "/rewards", label: "Rewards" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/achievements", label: "Achievements" },
  { href: "/analytics", label: "Analytics" },
  { href: "/config", label: "Bot Configuration" },
];
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <nav className="sidebar">
            <div className="brand">Overland Core</div>
            <div className="tag">Overland Finance admin</div>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="navlink">{n.label}</a>
            ))}
            <div style={{ marginTop: 24, borderTop: "1px solid #1e2a25", paddingTop: 16 }}>
              <a href="/api/auth/login" className="navlink">Sign in with Discord</a>
              <a href="/api/auth/logout" className="navlink">Sign out</a>
            </div>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
