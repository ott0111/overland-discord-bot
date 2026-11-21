"use client";
import { useEffect, useState } from "react";
import { INFO_PAGES } from "@overland/shared";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading } from "../../components/ui";

interface ConfigRow { id: string; key: string; value: unknown; updatedAt: string; }

export default function ConfigPage() {
  const data = useFetch<ConfigRow[]>("/api/config");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data.data) {
      const next: Record<string, string> = {};
      for (const r of data.data) next[r.key] = JSON.stringify(r.value, null, 2);
      setEdits(next);
      const infoRow = data.data.find((r) => r.key === "infoContent")?.value as Record<string, string> | undefined;
      if (infoRow) {
        const filled: Record<string, string> = {};
        for (const p of INFO_PAGES) filled[p] = infoRow[p] ?? "";
        setInfo(filled);
      }
    }
  }, [data.data]);

  async function save(key: string, raw: string) {
    setMsg(""); setErr("");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      setErr("Invalid JSON for key " + key + ". Fix it before saving.");
      return;
    }
    const res = await api("/api/config", "POST", { key, value });
    if (!res.ok) setErr(res.error);
    else { setMsg("Configuration key " + key + " saved."); data.reload(); }
  }
  async function saveInfo() {
    setMsg(""); setErr("");
    const res = await api("/api/config", "POST", { key: "infoContent", value: info });
    if (!res.ok) setErr(res.error);
    else { setMsg("Info content saved. The /about, /links, /team, /roadmap, /updates, /faq, /opportunities and /socials bot commands read these values."); data.reload(); }
  }
  const rows = data.data ?? [];
  return (
    <div>
      <PageHead title="Bot Configuration" sub="Database-backed bot configuration: channels, point values, info content and integration settings. No hardcoded IDs. Every save writes an AuditLog entry." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title="Info content (bot commands: /about, /links, /team, /roadmap, /updates, /faq, /opportunities, /socials)">
        {INFO_PAGES.map((p) => (
          <Field key={p} label={p}>
            <textarea className="input" rows={2} value={info[p] ?? ""} onChange={(e) => setInfo((prev) => ({ ...prev, [p]: e.target.value }))} />
          </Field>
        ))}
        <Btn kind="primary" onClick={saveInfo}>Save info content</Btn>
      </Card>
      <Card title={"All configuration keys (" + rows.length + ")"}>
        {rows.length === 0 && !data.loading ? <p className="muted">No configuration rows yet. Run the seed script to create point values, daily limits, verification, moderation, X integration, welcome and info content defaults.</p> : null}
        {rows.map((r) => (
          <div key={r.id} style={{ borderBottom: "1px solid #1a231f", padding: "12px 0" }}>
            <p><code>{r.key}</code> <span className="muted">updated {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "n/a"}</span></p>
            <Field label={"Value (JSON)"}>
              <textarea className="input" rows={4} value={edits[r.key] ?? ""} onChange={(e) => setEdits((prev) => ({ ...prev, [r.key]: e.target.value }))} spellCheck={false} />
            </Field>
            <Btn kind="primary" onClick={() => save(r.key, edits[r.key] ?? "{}")}>Save {r.key}</Btn>
          </div>
        ))}
      </Card>
    </div>
  );
}
