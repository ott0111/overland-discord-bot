"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const GROUPS = [
  { label: "Workspace", items: [
    { href: "/", label: "Overview", icon: "OV" },
    { href: "/analytics", label: "Analytics", icon: "AN" },
  ]},
  { label: "Community", items: [
    { href: "/members", label: "Members", icon: "MB" },
    { href: "/roles", label: "Public roles", icon: "RL" },
    { href: "/team", label: "Internal team", icon: "TM" },
    { href: "/permissions", label: "Permissions", icon: "PM" },
    { href: "/welcome", label: "Welcome & verification", icon: "WV" },
    { href: "/moderation", label: "Moderation & security", icon: "MS" },
    { href: "/tickets", label: "Tickets", icon: "TK" },
  ]},
  { label: "Engagement", items: [
    { href: "/points", label: "Points & economy", icon: "EC" },
    { href: "/campaigns", label: "Campaigns", icon: "CA" },
    { href: "/referrals", label: "Referrals", icon: "RF" },
    { href: "/rewards", label: "Rewards", icon: "RW" },
    { href: "/leaderboards", label: "Leaderboards", icon: "LB" },
    { href: "/achievements", label: "Achievements", icon: "AC" },
  ]},
  { label: "Integrations", items: [
    { href: "/x", label: "X integration", icon: "X" },
    { href: "/config", label: "Bot configuration", icon: "CF" },
  ]},
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
        <span />
        <span />
        <span />
      </button>
      {open ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
      <aside className={"sidebar" + (open ? " sidebar-open" : "")}>
        <Link href="/" className="brand-lockup" onClick={() => setOpen(false)}>
          <span className="brand-mark">O</span>
          <span className="brand-copy">
            <strong>OVERLAND</strong>
            <small>CORE CONSOLE</small>
          </span>
        </Link>
        <div className="workspace-switcher">
          <span className="workspace-avatar">OF</span>
          <span className="workspace-copy"><strong>Overland Finance</strong><small>Community workspace</small></span>
          <span className="workspace-chevron">⌄</span>
        </div>
        <div className="nav-scroll">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={"navlink" + (active ? " active" : "")}>
                    <span className="nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                    {active ? <span className="nav-active-dot" /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="system-status"><span className="status-dot" /><span><strong>Console online</strong><small>Workspace services</small></span></div>
          <Link href="/api/auth/login" className="navlink auth-link"><span className="nav-icon">ID</span><span>Sign in with Discord</span></Link>
          <Link href="/api/auth/logout" className="navlink auth-link"><span className="nav-icon">↗</span><span>Sign out</span></Link>
          <div className="sidebar-version">OVERLAND CORE <span>ADMIN</span></div>
        </div>
      </aside>
    </>
  );
}
