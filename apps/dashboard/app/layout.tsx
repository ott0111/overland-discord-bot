import React from "react";
import "./globals.css";
import Sidebar from "../components/sidebar";

export const metadata = {
  title: "Overland Core | Admin Console",
  description: "The operations console for Overland Finance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="main">
            <header className="topbar">
              <div className="topbar-context">
                <span className="topbar-eyebrow">OVERLAND FINANCE</span>
                <span className="topbar-divider">/</span>
                <span className="topbar-current">Administration</span>
              </div>
              <div className="topbar-right">
                <span className="environment-pill"><span className="status-dot" /> CONTROL CENTER</span>
                <a className="topbar-discord" href="/api/auth/login">Connect Discord <span>↗</span></a>
              </div>
            </header>
            <div className="page-content">{children}</div>
            <footer className="app-footer">
              <span>OVERLAND CORE <span className="footer-separator">/</span> COMMUNITY OPERATIONS</span>
              <span>BUILT FOR THE OVERLAND COMMUNITY</span>
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
