"use client";
import { useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface Reward { id: string; name: string; description: string; imageUrl: string | null; costOvercredits: number; stock: number | null; eligibility: string | null; active: boolean; _count: { claims: number }; }
interface Claim { id: string; status: string; costOvercredits: number; createdAt: string; reward: { name: string }; member: { user: { username: string; discordId: string } }; }
interface RewardsData { rewards: Reward[]; claims: Claim[]; }

export default function RewardsPage() {
  const data = useFetch<RewardsData>("/api/rewards");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", description: "", imageUrl: "", costOvercredits: "100", stock: "", eligibility: "", active: true });
  const [edits, setEdits] = useState<Record<string, { cost: string; stock: string; active: boolean }>>({});

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/rewards", "POST", {
      name: f.name, description: f.description, imageUrl: f.imageUrl || undefined,
      costOvercredits: Number(f.costOvercredits), stock: f.stock === "" ? null : Number(f.stock),
      eligibility: f.eligibility || undefined, active: f.active,
    });
    if (!res.ok) setErr(res.error);
    else { setMsg("Reward " + f.name + " created."); setF({ name: "", description: "", imageUrl: "", costOvercredits: "100", stock: "", eligibility: "", active: true }); data.reload(); }
  }
  async function decideClaim(id: string, status: string) {
    setMsg(""); setErr("");
    const res = await api("/api/rewards", "PATCH", { claimId: id, status });
    if (!res.ok) setErr(res.error);
    else { setMsg("Claim " + status.toLowerCase() + "."); data.reload(); }
  }
  async function saveReward(r: Reward) {
    setMsg(""); setErr("");
    const e = edits[r.id] ?? { cost: String(r.costOvercredits), stock: r.stock === null ? "" : String(r.stock), active: r.active };
    const res = await api("/api/rewards", "PATCH", { rewardId: r.id, costOvercredits: Number(e.cost), stock: e.stock === "" ? null : Number(e.stock), active: e.active });
    if (!res.ok) setErr(res.error);
    else { setMsg("Reward " + r.name + " updated."); data.reload(); }
  }
  const rewards = data.data?.rewards ?? [];
  const claims = data.data?.claims ?? [];
  const pending = claims.filter((c) => c.status === "PENDING");
  return (
    <div>
      <PageHead title="Rewards" sub="Rewards marketplace: create, edit, price, stock, approve or reject claims and view redemption history. Claims deduct Overcredits atomically in the bot, so staff decisions here never move points twice." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title={"Rewards (" + rewards.length + ")"}>
        {rewards.length === 0 && !data.loading ? <p className="muted">No rewards yet.</p> : null}
        {rewards.map((r) => {
          const e = edits[r.id] ?? { cost: String(r.costOvercredits), stock: r.stock === null ? "" : String(r.stock), active: r.active };
          return (
            <div key={r.id} style={{ borderBottom: "1px solid #1a231f", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <strong>{r.name}</strong>
                <span>{r.active ? <span className="badge badge-green">active</span> : <span className="badge badge-red">disabled</span>} <span className="muted">{r._count.claims} claims</span></span>
              </div>
              <p className="muted" style={{ margin: "6px 0" }}>{r.description} {r.eligibility ? "Eligibility: " + r.eligibility : ""} {r.stock === null ? "Unlimited stock." : "Stock: " + r.stock + "."}</p>
              <div className="form-row">
                <Field label="Cost (Overcredits)"><input className="input" type="number" min={0} value={e.cost} onChange={(ev) => setEdits((prev) => ({ ...prev, [r.id]: { ...e, cost: ev.target.value } }))} /></Field>
                <Field label="Stock (blank for unlimited)"><input className="input" type="number" min={0} value={e.stock} onChange={(ev) => setEdits((prev) => ({ ...prev, [r.id]: { ...e, stock: ev.target.value } }))} /></Field>
                <label className="checkbox-row"><input type="checkbox" checked={e.active} onChange={(ev) => setEdits((prev) => ({ ...prev, [r.id]: { ...e, active: ev.target.checked } }))} /> Active</label>
                <Btn kind="primary" onClick={() => saveReward(r)}>Save</Btn>
              </div>
            </div>
          );
        })}
      </Card>
      <Card title="Create reward">
        <form onSubmit={create}>
          <div className="form-row">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Cost (Overcredits)"><input className="input" type="number" min={0} value={f.costOvercredits} onChange={(e) => setF({ ...f, costOvercredits: e.target.value })} required /></Field>
            <Field label="Stock (blank for unlimited)"><input className="input" type="number" min={0} value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
          <div className="form-row">
            <Field label="Image URL (optional)"><input className="input" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} /></Field>
            <Field label="Eligibility"><input className="input" value={f.eligibility} onChange={(e) => setF({ ...f, eligibility: e.target.value })} placeholder="e.g. Citizen role required" /></Field>
            <label className="checkbox-row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
            <Btn kind="primary" type="submit">Create reward</Btn>
          </div>
        </form>
      </Card>
      <Card title={"Claims pending review (" + pending.length + ")"}>
        {pending.length === 0 ? <p className="muted">No pending claims.</p> : (
          <table className="table">
            <thead><tr><th>Member</th><th>Reward</th><th>Cost</th><th>When</th><th>Actions</th></tr></thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td>{c.member.user.username}<br /><span className="muted">{c.member.user.discordId}</span></td>
                  <td>{c.reward.name}</td>
                  <td>{c.costOvercredits}</td>
                  <td className="muted">{fmtDate(c.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn kind="primary" onClick={() => decideClaim(c.id, "APPROVED")}>Approve</Btn>
                      <Btn kind="danger" onClick={() => decideClaim(c.id, "REJECTED")}>Reject</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {claims.filter((c) => c.status !== "PENDING").length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h3>Claim history</h3>
            <table className="table">
              <thead><tr><th>Member</th><th>Reward</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {claims.filter((c) => c.status !== "PENDING").slice(0, 20).map((c) => (
                  <tr key={c.id}><td>{c.member.user.username}</td><td>{c.reward.name}</td><td><span className="badge">{c.status}</span></td><td className="muted">{fmtDate(c.createdAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
