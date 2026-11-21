"use client";
import { useState } from "react";
import { PERMISSION_GROUPS } from "@overland/shared";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading } from "../../components/ui";

interface TeamRow {
  id: string; discordId: string; username: string; publicRole: string; jobTitle: string;
  department: string; responsibilities: string | null; status: string; addedAt: string;
  group: { id: string; name: string };
}

const GROUP_LABELS: Record<string, string> = { Rewards_Management: "Rewards Management" };
function groupLabel(name: string) { return GROUP_LABELS[name] ?? name; }

export default function TeamPage() {
  const team = useFetch<TeamRow[]>("/api/team");
  const permData = useFetch<{ groups: { id: string; name: string }[] }>("/api/permissions");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [f, setF] = useState({ discordId: "", username: "", jobTitle: "", department: "", responsibilities: "", publicRole: "", groupName: "Support" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/team", "POST", f);
    if (!res.ok) setErr(res.error);
    else { setMsg("Staff member " + f.username + " added."); setF({ discordId: "", username: "", jobTitle: "", department: "", responsibilities: "", publicRole: "", groupName: "Support" }); team.reload(); }
  }
  async function patch(id: string, body: Record<string, unknown>, label: string) {
    setMsg(""); setErr("");
    const res = await api("/api/team", "PATCH", { id, ...body });
    if (!res.ok) setErr(res.error);
    else { setMsg(label); team.reload(); }
  }
  async function remove(id: string, username: string) {
    if (!window.confirm("Remove " + username + " from the internal team? Their Discord roles are not changed by this.")) return;
    setMsg(""); setErr("");
    const res = await api("/api/team?id=" + id, "DELETE");
    if (!res.ok) setErr(res.error);
    else { setMsg(username + " removed from the team."); team.reload(); }
  }
  const list = team.data ?? [];
  return (
    <div>
      <PageHead title="Internal Team" sub="Private staff records: Discord ID, job title, department, responsibilities, permission group and status. Never visible to members." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {team.loading ? <Loading /> : null}
      {team.error ? <Err msg={team.error} /> : null}
      <Card title={"Staff (" + list.length + ")"}>
        {list.length === 0 && !team.loading ? <p className="muted">No staff records yet.</p> : null}
        {list.length > 0 ? (
          <table className="table">
            <thead><tr><th>Username</th><th>Discord ID</th><th>Job title</th><th>Department</th><th>Permission group</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.username}</strong><br /><span className="muted">{t.publicRole}</span></td>
                  <td className="muted">{t.discordId}</td>
                  <td>{t.jobTitle}</td>
                  <td>{t.department}</td>
                  <td>
                    <select className="input" value={t.group.id} onChange={(e) => patch(t.id, { groupId: e.target.value }, t.username + " moved to " + groupLabel((permData.data?.groups ?? []).find((g) => g.id === e.target.value)?.name ?? "") + ".")}>
                      {(permData.data?.groups ?? [{ id: t.group.id, name: t.group.name }]).map((g) => (
                        <option key={g.id} value={g.id}>{groupLabel(g.name)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="input" value={t.status} onChange={(e) => patch(t.id, { status: e.target.value }, t.username + " status set to " + e.target.value + ".")}>
                      {["ACTIVE", "INACTIVE", "SUSPENDED", "REMOVED"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><Btn kind="danger" onClick={() => remove(t.id, t.username)}>Remove</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="muted" style={{ fontSize: 13 }}>Note: changing a member's permission group is done from the Permissions page after the group exists; status changes here take effect immediately for dashboard and bot access.</p>
      </Card>
      <Card title="Add staff member">
        <form onSubmit={add}>
          <div className="form-row">
            <Field label="Discord ID"><input className="input" value={f.discordId} onChange={(e) => setF({ ...f, discordId: e.target.value })} required /></Field>
            <Field label="Username"><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></Field>
            <Field label="Job title"><input className="input" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} required /></Field>
            <Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} required /></Field>
          </div>
          <div className="form-row">
            <Field label="Public role"><input className="input" value={f.publicRole} onChange={(e) => setF({ ...f, publicRole: e.target.value })} placeholder="Defaults to job title" /></Field>
            <Field label="Permission group">
              <select className="input" value={f.groupName} onChange={(e) => setF({ ...f, groupName: e.target.value })}>
                {PERMISSION_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Responsibilities"><input className="input" value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} /></Field>
            <Btn kind="primary" type="submit">Add staff member</Btn>
          </div>
        </form>
      </Card>
    </div>
  );
}
