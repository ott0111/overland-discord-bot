"use client";
import { useEffect, useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface XPost { id: string; postId: string; authorUsername: string; text: string; url: string; isReply: boolean; isRepost: boolean; announcedAt: string | null; createdAt: string; }
interface XData { config: Record<string, unknown>; posts: XPost[]; }

export default function XPage() {
  const data = useFetch<XData>("/api/x");
  const [cfg, setCfg] = useState({ enabled: false, username: "OverlandFinance", announcementChannelId: "", ignoreReplies: true, ignoreReposts: true, pollMinutes: 15 });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (data.data?.config) {
      const c = data.data.config;
      setCfg({
        enabled: Boolean(c.enabled),
        username: String(c.username ?? "OverlandFinance"),
        announcementChannelId: String(c.announcementChannelId ?? ""),
        ignoreReplies: c.ignoreReplies !== false,
        ignoreReposts: c.ignoreReposts !== false,
        pollMinutes: Number(c.pollMinutes ?? 15),
      });
    }
  }, [data.data]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/x", "POST", { action: "config", value: cfg });
    if (!res.ok) setErr(res.error);
    else { setMsg("X integration settings saved."); data.reload(); }
  }
  async function announce(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/x", "POST", { action: "announce", text, url });
    if (!res.ok) setErr(res.error);
    else {
      const published = Boolean((res.data as { published?: boolean } | undefined)?.published);
      setMsg(published ? "Manual announcement published to the configured Discord channel." : "Announcement saved, but it was not published. Check that a valid text announcement channel is configured and the bot can send messages there.");
      setText(""); setUrl(""); data.reload();
    }
  }
  const posts = data.data?.posts ?? [];
  return (
    <div>
      <PageHead title="X Integration" sub="Configure the official X account, announcement channel, polling interval and reply/repost filtering. Requires X_BEARER_TOKEN on the bot. Without API access the bot cannot poll X, and this page says so instead of pretending otherwise." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title="Configuration">
        <form onSubmit={saveConfig}>
          <div className="form-row">
            <Field label="X username"><input className="input" value={cfg.username} onChange={(e) => setCfg({ ...cfg, username: e.target.value })} /></Field>
            <Field label="Announcement channel ID"><input className="input" value={cfg.announcementChannelId} onChange={(e) => setCfg({ ...cfg, announcementChannelId: e.target.value })} placeholder="Discord channel ID" /></Field>
            <Field label="Poll interval (minutes)"><input className="input" type="number" min={1} value={cfg.pollMinutes} onChange={(e) => setCfg({ ...cfg, pollMinutes: Number(e.target.value) })} /></Field>
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Integration enabled</label>
          <label className="checkbox-row"><input type="checkbox" checked={cfg.ignoreReplies} onChange={(e) => setCfg({ ...cfg, ignoreReplies: e.target.checked })} /> Ignore replies</label>
          <label className="checkbox-row"><input type="checkbox" checked={cfg.ignoreReposts} onChange={(e) => setCfg({ ...cfg, ignoreReposts: e.target.checked })} /> Ignore reposts</label>
          <Btn kind="primary" type="submit">Save X settings</Btn>
        </form>
      </Card>
      <Card title="Manual announcement">
        <form onSubmit={announce}>
          <Field label="Post text"><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} required /></Field>
          <Field label="Original post link"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/..." required /></Field>
          <Btn kind="primary" type="submit">Record manual announcement</Btn>
        </form>
      </Card>
      <Card title={"Post history (" + posts.length + ")"}>
        {posts.length === 0 ? <p className="muted">No posts recorded yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>Author</th><th>Text</th><th>Flags</th><th>Announced</th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{fmtDate(p.createdAt)}</td>
                  <td>@{p.authorUsername}</td>
                  <td><a href={p.url} target="_blank" rel="noreferrer">{p.text.slice(0, 140)}</a></td>
                  <td>{p.isReply ? <span className="badge">reply</span> : null} {p.isRepost ? <span className="badge">repost</span> : null}</td>
                  <td>{p.announcedAt ? fmtDate(p.announcedAt) : "not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
