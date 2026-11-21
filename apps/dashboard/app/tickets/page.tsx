"use client";
import { useState } from "react";
import { TICKET_CATEGORIES } from "@overland/shared";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface TicketRow {
  id: string; number: number; category: string; status: string; claimedBy: string | null;
  rating: number | null; createdAt: string; closedAt: string | null; firstResponseAt: string | null;
  member: { user: { username: string; discordId: string } };
  _count: { messages: number };
}
interface TicketDetail extends Omit<TicketRow, "_count"> {
  messages: { id: string; authorId: string; content: string; createdAt: string }[];
}

export default function TicketsPage() {
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useFetch<TicketRow[]>("/api/tickets" + (status ? "?status=" + status : ""));
  const detail = useFetch<TicketDetail>(openId ? "/api/tickets?id=" + openId : null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function act(id: string, action: string) {
    setMsg(""); setErr("");
    const res = await api("/api/tickets", "PATCH", { id, action });
    if (!res.ok) setErr(res.error);
    else { setMsg("Ticket " + action + " done."); list.reload(); if (openId) detail.reload(); }
  }
  const items = list.data ?? [];
  return (
    <div>
      <PageHead title="Tickets" sub="Ticket queue by category, assignment, transcripts, ratings and response times." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      <Card>
        <Field label="Filter by status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["OPEN", "CLAIMED", "CLOSED", "ARCHIVED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <p className="muted">Categories: {TICKET_CATEGORIES.join(", ")}</p>
      </Card>
      {list.loading ? <Loading /> : null}
      {list.error ? <Err msg={list.error} /> : null}
      <Card title={"Tickets (" + items.length + ")"}>
        {items.length === 0 && !list.loading ? <p className="muted">No tickets in this view.</p> : null}
        {items.length > 0 ? (
          <table className="table">
            <thead><tr><th>#</th><th>Member</th><th>Category</th><th>Status</th><th>Messages</th><th>Opened</th><th>Rating</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>#{t.number}</td>
                  <td>{t.member.user.username}<br /><span className="muted">{t.member.user.discordId}</span></td>
                  <td>{t.category}</td>
                  <td><span className="badge">{t.status}</span></td>
                  <td>{t._count.messages}</td>
                  <td className="muted">{fmtDate(t.createdAt)}</td>
                  <td>{t.rating ? t.rating + "/5" : "n/a"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Btn onClick={() => setOpenId(openId === t.id ? null : t.id)}>{openId === t.id ? "Hide" : "Transcript"}</Btn>
                      {t.status === "OPEN" ? <Btn kind="primary" onClick={() => act(t.id, "claim")}>Claim</Btn> : null}
                      {t.status !== "CLOSED" && t.status !== "ARCHIVED" ? <Btn onClick={() => act(t.id, "close")}>Close</Btn> : null}
                      {t.status === "CLOSED" ? <Btn onClick={() => act(t.id, "reopen")}>Reopen</Btn> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      {openId ? (
        <Card title="Transcript">
          {detail.loading ? <Loading /> : null}
          {detail.error ? <Err msg={detail.error} /> : null}
          {detail.data ? (
            <div>
              <p>Ticket #{detail.data.number} | {detail.data.category} | {detail.data.status} | first response: {fmtDate(detail.data.firstResponseAt)}</p>
              {detail.data.messages.length === 0 ? <p className="muted">No messages recorded for this ticket.</p> : (
                detail.data.messages.map((m) => (
                  <div key={m.id} style={{ borderBottom: "1px solid #1a231f", padding: "8px 0" }}>
                    <span className="muted">{fmtDate(m.createdAt)} | {m.authorId}</span>
                    <p style={{ margin: "4px 0" }}>{m.content}</p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
