"use client";

import { useEffect, useState } from "react";

export default function LoginScreen({ accessDenied, username }: { accessDenied: boolean; username: string | null }) {
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    setConfigError(new URLSearchParams(window.location.search).get("auth") === "config");
  }, []);

  return (
    <main className="login-shell">
      <div className="login-orbit login-orbit-one" />
      <div className="login-orbit login-orbit-two" />
      <section className="login-panel">
        <div className="login-brand"><span className="login-mark">O</span><span><strong>OVERLAND</strong><small>CORE CONSOLE</small></span></div>
        <div className="login-kicker"><span className="status-dot" /> PRIVATE OPERATIONS ENVIRONMENT</div>
        <h1>{accessDenied ? "Staff access required." : "Your command center."}</h1>
        <p className="login-description">{accessDenied ? `Signed in as ${username}, but this Discord account is not assigned to the Overland internal team.` : "A secure workspace for managing the Overland community, operations, rewards, and engagement."}</p>
        {configError ? <div className="login-alert">Discord login is not configured for this deployment. Set DISCORD_CLIENT_ID and NEXTAUTH_URL in Vercel, then redeploy.</div> : null}
        {accessDenied ? <a className="discord-login-button secondary-login-button" href="/api/auth/logout">Sign out and use another account <span>↗</span></a> : (
          <a className="discord-login-button" href="/api/auth/login">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.7 5.1a18.5 18.5 0 0 0-4.6-1.4l-.6 1.2a17 17 0 0 0-5 0l-.6-1.2a18.5 18.5 0 0 0-4.6 1.4C1.4 9.3.6 13.4 1 17.4a18.7 18.7 0 0 0 5.7 2.9l1.2-2a12 12 0 0 1-1.9-.9l.5-.4a13.4 13.4 0 0 0 11 0l.5.4a12 12 0 0 1-1.9.9l1.2 2a18.7 18.7 0 0 0 5.7-2.9c.5-4.6-.8-8.7-3.3-12.3ZM8.7 14.9c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.6 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z"/></svg>
            Continue with Discord <span>↗</span>
          </a>
        )}
        <div className="login-security"><span className="security-icon">⌑</span><span>Discord authentication · Staff access only</span></div>
      </section>
      <footer className="login-footer"><span>OVERLAND CORE</span><span>AUTHORIZED PERSONNEL ONLY</span></footer>
    </main>
  );
}
