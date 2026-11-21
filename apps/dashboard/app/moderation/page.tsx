"use client";
import { useEffect, useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface ConfigRow { key: string; value: unknown }
interface ModAction { id: string; type: string; reason: string | null; actorId: string; durationMinutes: number | null; createdAt: string; target: { user: { username: string } }; }

export default function ModerationPage() {
  const config = useFetch<ConfigRow[]>("/api/config");
  const actions = useFetch<ModAction[]>("/api/moderation");
  const [mod, setMod] = useState({ profanityFilter: true, inviteFilter: true, maxMentions: 5, spamWindowSeconds: 10, spamMaxMessages: 5 });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (config.data) {
      const row = config.data.find((r) => r.key === "moderation")?.value as Record<string, unknown> | undefined;
      if (row) {
        setMod({
          profanityFilter: row.profanityFilter !== false,
          inviteFilter: row.inviteFilter !== false,
          maxMentions: Number(row.maxMentions ?? 5),
          spamWindowSeconds: Number(row.spamWindowSeconds ?? 10),
          spamMaxMessages: Number(row.spamMaxMessages ?? 5),
        });
      }
    }
  }, [config.data]);

  async function save() {
    setMsg(""); setErr("");
    const res = await api("/api/config", "POST", { key: "moderation", value: mod });
    if (!res.ok) setErr(res.error);
    else { setMsg("Moderation settings saved."); config.reload(); }
  }
  const list = actions.data ?? [];
  return (
    <div>
      <PageHead title="Moderation and Security" sub="Anti-spam, anti-raid, phishing and link filters, profanity settings, lockdown and moderation history. Uncertain scam classifications are never auto-punished." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      <Card title="Moderation configuration">
        <label className="checkbox-row"><input type="checkbox" checked={mod.profanityFilter} onChange={(e) => setMod({ ...mod, profanityFilter: e.target.checked })} /> Profanity filter</label>
        <label className="checkbox-row"><input type="checkbox" checked={mod.inviteFilter} onChange={(e) => setMod({ ...mod, inviteFilter: e.target.checked })} /> Invite link filter</label>
        <div className="form-row">
          <Field label="Max mentions per message"><input className="input" type="number" min={1} value={mod.maxMentions} onChange={(e) => setMod({ ...mod, maxMentions: Number(e.target.value) })} /></Field>
          <Field label="Spam window (seconds)"><input className="input" type="number" min={1} value={mod.spamWindowSeconds} onChange={(e) => setMod({ ...mod, spamWindowSeconds: Number(e.target.value) })} /></Field>
          <Field label="Max messages in spam window"><input className="input" type="number" min={1} value={mod.spamMaxMessages} onChange={(e) => setMod({ ...mod, spamMaxMessages: Number(e.target.value) })} /></Field>
        </div>
        <Btn kind="primary" onClick={save}>Save moderation settings</Btn>
      </Card>
      <Card title={"Recent moderation actions (" + list.length + ")"}>
        {actions.loading ? <Loading /> : null}
        {actions.error ? <Err msg={actions.error} /> : null}
        {list.length === 0 && !actions.loading ? <p className="muted">No moderation actions recorded yet.</p> : null}
        {list.length > 0 ? (
          <table className="table">
            <thead><tr><th>When</th><th>Member</th><th>Type</th><th>Reason</th><th>Duration</th><th>Actor</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{fmtDate(a.createdAt)}</td>
                  <td>{a.target.user.username}</td>
                  <td><span className="badge">{a.type}</span></td>
                  <td>{a.reason ?? ""}</td>
                  <td>{a.durationMinutes ? a.durationMinutes + " min" : "n/a"}</td>
                  <td className="muted">{a.actorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
