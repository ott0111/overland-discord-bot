"use client";
import { useCallback, useEffect, useState } from "react";

/** Shared dashboard UI: brand styling, fetch helpers, form primitives. */

export function useFetch<T>(url: string | null): { data: T | null; loading: boolean; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          let msg = "Request failed (" + r.status + ")";
          try {
            const j = (await r.json()) as { error?: string };
            if (j && j.error) msg = j.error;
          } catch {
            // Keep the status message.
          }
          throw new Error(msg);
        }
        return r.json() as Promise<T>;
      })
      .then((j) => {
        if (alive) setData(j);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Request failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);
  return { data, loading, error, reload };
}

export async function api<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok) {
      const err = (j && (j as { error?: string }).error) || "Request failed (" + r.status + ")";
      return { ok: false, data: null, error: err };
    }
    return { ok: true, data: j, error: "" };
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : "Request failed" };
  }
}

export function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>{title}</h1>
      <p className="muted" style={{ margin: 0 }}>{sub}</p>
    </div>
  );
}

export function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="card">
      {title ? <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h2> : null}
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div style={{ fontSize: 28, color: "#00C982", fontWeight: 700 }}>{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  kind,
  disabled,
  type,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  kind?: "primary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick} className={"btn" + (kind === "primary" ? " btn-primary" : kind === "danger" ? " btn-danger" : "")}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Loading() {
  return <p className="muted">Loading...</p>;
}

export function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  const needsLogin = msg.includes("401") || msg.toLowerCase().includes("unauthorized");
  return (
    <div className="err">
      {msg}
      {needsLogin ? (
        <span>
          {" "}
          <a href="/api/auth/login">Sign in with Discord</a>
        </span>
      ) : null}
    </div>
  );
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "n/a";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  return n.toLocaleString();
}
