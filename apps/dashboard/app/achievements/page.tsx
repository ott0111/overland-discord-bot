"use client";
import { useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading } from "../../components/ui";

interface Achievement { id: string; key: string; name: string; description: string; kind: string; threshold: number; overpointsReward: number; overcreditsReward: number; active: boolean; _count: { members: number }; }

export default function AchievementsPage() {
  const data = useFetch<Achievement[]>("/api/achievements");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", description: "", kind: "CUSTOM", threshold: "1", overpointsReward: "0", overcreditsReward: "0" });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/achievements", "POST", {
      name: f.name, description: f.description, kind: f.kind,
      threshold: Number(f.threshold), overpointsReward: Number(f.overpointsReward), overcreditsReward: Number(f.overcreditsReward),
    });
    if (!res.ok) setErr(res.error);
    else { setMsg("Achievement " + f.name + " created."); setF({ name: "", description: "", kind: "CUSTOM", threshold: "1", overpointsReward: "0", overcreditsReward: "0" }); data.reload(); }
  }
  const list = data.data ?? [];
  return (
    <div>
      <PageHead title="Achievements" sub="Achievements, daily streaks, weekly challenges, polls, Member of the Month and Weekly Spotlight. Create custom achievements here; the bot awards them when members hit the threshold." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title={"Achievements (" + list.length + ")"}>
        {list.length === 0 && !data.loading ? <p className="muted">No achievements yet. Run the seed script for the built-in set (first verification, first contribution, first referral, streaks).</p> : null}
        {list.length > 0 ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Kind</th><th>Threshold</th><th>Overpoints</th><th>Overcredits</th><th>Earned by</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong><br /><span className="muted">{a.description}</span></td>
                  <td><span className="badge">{a.kind}</span></td>
                  <td>{a.threshold}</td>
                  <td>{a.overpointsReward}</td>
                  <td>{a.overcreditsReward}</td>
                  <td>{a._count.members} members</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card title="Create custom achievement">
        <form onSubmit={create}>
          <div className="form-row">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Kind">
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {["VERIFICATION", "CONTRIBUTION", "REFERRAL", "SOCIAL", "MILESTONE", "EVENT", "STREAK", "CUSTOM"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Threshold"><input className="input" type="number" min={1} value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
          <div className="form-row">
            <Field label="Overpoints reward"><input className="input" type="number" min={0} value={f.overpointsReward} onChange={(e) => setF({ ...f, overpointsReward: e.target.value })} /></Field>
            <Field label="Overcredits reward"><input className="input" type="number" min={0} value={f.overcreditsReward} onChange={(e) => setF({ ...f, overcreditsReward: e.target.value })} /></Field>
            <Btn kind="primary" type="submit">Create achievement</Btn>
          </div>
        </form>
      </Card>
    </div>
  );
}
