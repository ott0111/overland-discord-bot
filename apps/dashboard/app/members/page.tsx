"use client";
import { useState } from "react";
import { useFetch, PageHead, Card, Btn, Err, Loading, fmtDate, fmtNum } from "../../components/ui";

interface MemberRow {
  id: string;
  user: { username: string; discordId: string; avatarUrl: string | null };
  balance: { overpoints: number; overcredits: number; communityPoints: number; socialPoints: number; referralPoints: number; contributionPoints: number } | null;
  roles: { role: { name: string } }[];
  joinedAt: string | null;
  verifiedAt: string | null;
  messageCount: number;
  isSuspicious: boolean;
}
interface MemberDetail extends MemberRow {
  achievements: { achievement: { name: string } }[];
  transactions: { id: string; currency: string; category: string; amount: number; createdAt: string; reason: string | null }[];
  checkins: { date: string; streak: number }[];
  referralsGiven: unknown[];
}

export default function MembersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useFetch<{ items: MemberRow[]; total: number; pages: number }>(
    "/api/members?q=" + encodeURIComponent(query) + "&page=" + page + "&limit=20",
  );
  const detail = useFetch<MemberDetail>(selected ? "/api/members/" + selected : null);
  const items = list.data?.items ?? [];
  return (
    <div>
      <PageHead title="Members" sub="Searchable member records. Search by Discord ID or username; open a member to see balances, roles and history." />
      <Card>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <span>Search Discord ID or username</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. yeezy or 123456789" />
          </div>
          <Btn kind="primary" onClick={() => { setQuery(q); setPage(1); }}>Search</Btn>
          <Btn onClick={() => { setQ(""); setQuery(""); setPage(1); }}>Clear</Btn>
        </div>
      </Card>
      {list.error ? <Err msg={list.error} /> : null}
      {list.loading ? <Loading /> : null}
      <Card title={"Members (" + (list.data?.total ?? 0) + ")"}>
        {items.length === 0 && !list.loading ? <p className="muted">No members found. Members appear here once the bot records them.</p> : null}
        {items.length > 0 ? (
          <table className="table">
            <thead><tr><th>Username</th><th>Discord ID</th><th>Overpoints</th><th>Overcredits</th><th>Roles</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.username}{m.isSuspicious ? <span className="badge badge-red" style={{ marginLeft: 8 }}>flagged</span> : null}</td>
                  <td className="muted">{m.user.discordId}</td>
                  <td>{fmtNum(m.balance?.overpoints)}</td>
                  <td>{fmtNum(m.balance?.overcredits)}</td>
                  <td>{m.roles.map((r) => r.role.name).join(", ") || "none"}</td>
                  <td className="muted">{fmtDate(m.joinedAt)}</td>
                  <td><Btn onClick={() => setSelected(m.id)}>View</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <Btn disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
          <span className="muted">Page {page} of {list.data?.pages ?? 1}</span>
          <Btn disabled={page >= (list.data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</Btn>
        </div>
      </Card>
      {selected ? (
        <Card title="Member detail">
          {detail.loading ? <Loading /> : null}
          {detail.error ? <Err msg={detail.error} /> : null}
          {detail.data ? (
            <div>
              <p><strong>{detail.data.user.username}</strong> <span className="muted">{detail.data.user.discordId}</span></p>
              <p className="muted">Verified: {fmtDate(detail.data.verifiedAt)} | Messages: {detail.data.messageCount} | Check-ins recorded: {detail.data.checkins.length}</p>
              <div className="grid">
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.overpoints)}</div><div className="muted">Overpoints</div></div>
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.overcredits)}</div><div className="muted">Overcredits</div></div>
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.communityPoints)}</div><div className="muted">Community</div></div>
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.socialPoints)}</div><div className="muted">Social</div></div>
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.referralPoints)}</div><div className="muted">Referral</div></div>
                <div className="stat"><div style={{ fontSize: 22, color: "#00C982" }}>{fmtNum(detail.data.balance?.contributionPoints)}</div><div className="muted">Contribution</div></div>
              </div>
              <p>Roles: {detail.data.roles.map((r) => r.role.name).join(", ") || "none"}</p>
              <p>Achievements: {detail.data.achievements.map((a) => a.achievement.name).join(", ") || "none yet"}</p>
              <p>Successful referrals: {detail.data.referralsGiven.length}</p>
              <h3>Recent transactions</h3>
              {detail.data.transactions.length === 0 ? <p className="muted">No transactions yet.</p> : (
                <table className="table">
                  <thead><tr><th>When</th><th>Currency</th><th>Category</th><th>Amount</th><th>Reason</th></tr></thead>
                  <tbody>
                    {detail.data.transactions.map((t) => (
                      <tr key={t.id}><td>{fmtDate(t.createdAt)}</td><td>{t.currency}</td><td>{t.category}</td><td>{t.amount > 0 ? "+" : ""}{t.amount}</td><td className="muted">{t.reason ?? ""}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ marginTop: 12 }}><Btn onClick={() => setSelected(null)}>Close</Btn></div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
