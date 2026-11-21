import React from "react";
import { cookies } from "next/headers";
import "./globals.css";
import Sidebar from "../components/sidebar";
import LoginScreen from "../components/login-screen";
import { getSessionFromCookie } from "../lib/auth";

export const metadata = {
  title: "Overland Core | Admin Console",
  description: "The operations console for Overland Finance.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => name + "=" + value).join("; ");
  const session = getSessionFromCookie(cookieHeader);
  const isStaff = Boolean(session?.group);

  return (
    <html lang="en">
      <body>
        {isStaff ? (
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
                  <span className="topbar-user">{session?.username}</span>
                </div>
              </header>
              <div className="page-content">{children}</div>
              <footer className="app-footer">
                <span>OVERLAND CORE <span className="footer-separator">/</span> COMMUNITY OPERATIONS</span>
                <span>BUILT FOR THE OVERLAND COMMUNITY</span>
              </footer>
            </main>
          </div>
        ) : (
          <LoginScreen accessDenied={Boolean(session)} username={session?.username ?? null} />
        )}
      </body>
    </html>
  );
}
