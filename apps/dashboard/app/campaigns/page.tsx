"use client";
import { useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface Campaign { id: string; name: string; description: string; objectives: string | null; startsAt: string; endsAt: string; pointReward: number; status: string; _count: { submissions: number }; }
interface Submission {
  id: string; content: string; linkUrl: string | null; imageUrl: string | null; status: string;
  feedback: string | null; pointsAwarded: number; createdAt: string;
  campaign: { name: string };
  member: { user: { username: string; discordId: string } };
}
interface CampData { campaigns: Campaign[]; submissions: Submission[]; }

export default function CampaignsPage() {
  const data = useFetch<CampData>("/api/campaigns");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", description: "", objectives: "", startsAt: "", endsAt: "", pointReward: "20", submissionRequirements: "", tasks: "", status: "DRAFT" });
  const [review, setReview] = useState<Record<string, { points: string; feedback: string }>>({});

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/campaigns", "POST", { ...f, pointReward: Number(f.pointReward) });
    if (!res.ok) setErr(res.error);
    else { setMsg("Campaign " + f.name + " created."); setF({ name: "", description: "", objectives: "", startsAt: "", endsAt: "", pointReward: "20", submissionRequirements: "", tasks: "", status: "DRAFT" }); data.reload(); }
  }
  async function decide(sub: Submission, status: string) {
    setMsg(""); setErr("");
    const r = review[sub.id] ?? { points: String(sub.pointsAwarded || 0), feedback: "" };
    const res = await api("/api/campaigns", "PATCH", { submissionId: sub.id, status, feedback: r.feedback || undefined, pointsAwarded: Number(r.points) });
    if (!res.ok) setErr(res.error);
    else { setMsg("Submission " + status.toLowerCase() + (status === "APPROVED" && Number(r.points) > 0 ? " with " + r.points + " points awarded." : ".")); data.reload(); }
  }
  const campaigns = data.data?.campaigns ?? [];
  const submissions = data.data?.submissions ?? [];
  const pending = submissions.filter((s) => s.status === "PENDING");
  return (
    <div>
      <PageHead title="Social Campaigns" sub="Create and manage campaigns, review submissions, approve or reject and award points. Approved awards are atomic: balance, transaction and review land together." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title={"Campaigns (" + campaigns.length + ")"}>
        {campaigns.length === 0 && !data.loading ? <p className="muted">No campaigns yet.</p> : null}
        {campaigns.length > 0 ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Status</th><th>Starts</th><th>Ends</th><th>Reward</th><th>Submissions</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong><br /><span className="muted">{c.description.slice(0, 120)}</span></td>
                  <td><span className="badge">{c.status}</span></td>
                  <td className="muted">{fmtDate(c.startsAt)}</td>
                  <td className="muted">{fmtDate(c.endsAt)}</td>
                  <td>{c.pointReward}</td>
                  <td>{c._count.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card title="Create campaign">
        <form onSubmit={create}>
          <div className="form-row">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Point reward"><input className="input" type="number" min={0} value={f.pointReward} onChange={(e) => setF({ ...f, pointReward: e.target.value })} /></Field>
            <Field label="Status">
              <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {["DRAFT", "ACTIVE", "ENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
          <Field label="Objectives"><textarea className="input" rows={2} value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} /></Field>
          <div className="form-row">
            <Field label="Starts at"><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required /></Field>
            <Field label="Ends at"><input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required /></Field>
          </div>
          <Field label="Submission requirements"><input className="input" value={f.submissionRequirements} onChange={(e) => setF({ ...f, submissionRequirements: e.target.value })} /></Field>
          <Field label="Eligible tasks (one per line)"><textarea className="input" rows={3} value={f.tasks} onChange={(e) => setF({ ...f, tasks: e.target.value })} placeholder={"Original X post\nInfographic\nVideo"} /></Field>
          <Btn kind="primary" type="submit">Create campaign</Btn>
        </form>
      </Card>
      <Card title={"Submissions pending review (" + pending.length + ")"}>
        {pending.length === 0 ? <p className="muted">No pending submissions.</p> : (
          pending.map((s) => {
            const r = review[s.id] ?? { points: "20", feedback: "" };
            return (
              <div key={s.id} style={{ borderBottom: "1px solid #1a231f", padding: "12px 0" }}>
                <p><strong>{s.member.user.username}</strong> <span className="muted">{s.member.user.discordId}</span> | Campaign: {s.campaign.name} | {fmtDate(s.createdAt)}</p>
                <p>{s.content}</p>
                {s.linkUrl ? <p><a href={s.linkUrl} target="_blank" rel="noreferrer">{s.linkUrl}</a></p> : null}
                {s.imageUrl ? <p><a href={s.imageUrl} target="_blank" rel="noreferrer">Supporting image</a></p> : null}
                <div className="form-row">
                  <Field label="Points to award on approve"><input className="input" type="number" min={0} value={r.points} onChange={(e) => setReview((prev) => ({ ...prev, [s.id]: { ...r, points: e.target.value } }))} /></Field>
                  <Field label="Feedback"><input className="input" value={r.feedback} onChange={(e) => setReview((prev) => ({ ...prev, [s.id]: { ...r, feedback: e.target.value } }))} /></Field>
                  <Btn kind="primary" onClick={() => decide(s, "APPROVED")}>Approve and award</Btn>
                  <Btn kind="danger" onClick={() => decide(s, "REJECTED")}>Reject</Btn>
                </div>
              </div>
            );
          })
        )}
        {submissions.filter((s) => s.status !== "PENDING").length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h3>Reviewed submissions</h3>
            <table className="table">
              <thead><tr><th>Member</th><th>Campaign</th><th>Status</th><th>Points</th><th>Feedback</th></tr></thead>
              <tbody>
                {submissions.filter((s) => s.status !== "PENDING").slice(0, 20).map((s) => (
                  <tr key={s.id}><td>{s.member.user.username}</td><td>{s.campaign.name}</td><td><span className="badge">{s.status}</span></td><td>{s.pointsAwarded}</td><td className="muted">{s.feedback ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
