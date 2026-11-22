"use client";
import { useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading } from "../../components/ui";

interface RoleRow {
  id: string; name: string; description: string | null; isInternal: boolean; isSelfAssignable: boolean;
  discordRoleId: string | null; minOverpoints: number | null; sortOrder: number;
  requiresRole: { id: string; name: string } | null;
  _count: { members: number };
}

export default function RolesPage() {
  const roles = useFetch<RoleRow[]>("/api/roles");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { requiresRoleId: string; minOverpoints: string; isSelfAssignable: boolean }>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discordRoleId, setDiscordRoleId] = useState("");
  const [isSelfAssignable, setIsSelfAssignable] = useState(false);

  function draftFor(r: RoleRow) {
    return drafts[r.id] ?? { requiresRoleId: r.requiresRole?.id ?? "", minOverpoints: r.minOverpoints === null ? "" : String(r.minOverpoints), discordRoleId: r.discordRoleId ?? "", isSelfAssignable: r.isSelfAssignable };
  }
  function setDraft(id: string, patch: Partial<{ requiresRoleId: string; minOverpoints: string; discordRoleId: string; isSelfAssignable: boolean }>) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? { requiresRoleId: "", minOverpoints: "", discordRoleId: "", isSelfAssignable: false }), ...patch } }));
  }
  async function save(r: RoleRow) {
    setMsg(""); setErr("");
    const d = draftFor(r);
    const res = await api("/api/roles", "PATCH", {
      id: r.id,
      requiresRoleId: d.requiresRoleId || null,
      minOverpoints: d.minOverpoints === "" ? null : Number(d.minOverpoints),
      isSelfAssignable: d.isSelfAssignable,
      discordRoleId: d.discordRoleId.trim() || null,
    });
    if (!res.ok) setErr(res.error);
    else { setMsg("Role " + r.name + " updated."); roles.reload(); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/roles", "POST", { name, description, isSelfAssignable, discordRoleId: discordRoleId.trim() || null });
    if (!res.ok) setErr(res.error);
    else { setMsg("Role " + name + " created."); setName(""); setDescription(""); setDiscordRoleId(""); setIsSelfAssignable(false); roles.reload(); }
  }
  const list = roles.data ?? [];
  return (
    <div>
      <PageHead title="Public Roles" sub="Configure public roles, requirements, progression and self-assignable interest roles. Internal roles are managed under Team. Public roles never grant admin permissions." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {roles.loading ? <Loading /> : null}
      {roles.error ? <Err msg={roles.error} /> : null}
      <Card title="Roles">
        {list.length === 0 && !roles.loading ? <p className="muted">No roles yet. Run the seed script to create the official role set.</p> : null}
        {list.map((r) => {
          const d = draftFor(r);
          return (
            <div key={r.id} style={{ borderBottom: "1px solid #1a231f", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <strong>{r.name}</strong>
                <span>
                  {r.isInternal ? <span className="badge">internal</span> : null}{" "}
                  {r.isSelfAssignable ? <span className="badge">self-assignable</span> : null}{" "}
                  <span className="muted">{r._count.members} members</span>
                </span>
              </div>
              <p className="muted" style={{ margin: "6px 0" }}>{r.description ?? "No description."} {r.discordRoleId ? "Discord role ID: " + r.discordRoleId : "No Discord role linked yet."}</p>
              <div className="form-row">
                <Field label="Requires role">
                  <select className="input" value={d.requiresRoleId} onChange={(e) => setDraft(r.id, { requiresRoleId: e.target.value })}>
                    <option value="">None</option>
                    {list.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
                <Field label="Minimum Overpoints">
                  <input className="input" type="number" min={0} value={d.minOverpoints} onChange={(e) => setDraft(r.id, { minOverpoints: e.target.value })} placeholder="None" />
                </Field>
                <label className="checkbox-row"><input type="checkbox" checked={d.isSelfAssignable} onChange={(e) => setDraft(r.id, { isSelfAssignable: e.target.checked })} /> Self-assignable</label>
                <Btn kind="primary" onClick={() => save(r)}>Save</Btn>
              </div>
            </div>
          );
        })}
      </Card>
      <Card title="Create role">
        <form onSubmit={create}>
          <div className="form-row">
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>\n            <Field label="Discord Role ID"><input className="input" value={discordRoleId} onChange={(e) => setDiscordRoleId(e.target.value)} placeholder="Optional Discord role ID" /></Field>
            <label className="checkbox-row"><input type="checkbox" checked={isSelfAssignable} onChange={(e) => setIsSelfAssignable(e.target.checked)} /> Self-assignable interest role</label>
            <Btn kind="primary" type="submit">Create role</Btn>
          </div>
        </form>
      </Card>
    </div>
  );
}
