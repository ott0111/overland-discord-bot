"use client";
import { useEffect, useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Err, Loading } from "../../components/ui";

interface GroupRow { id: string; name: string; description: string | null; permissions: { key: string }[]; _count: { members: number } }
interface PermData { groups: GroupRow[]; allKeys: string[] }

const GROUP_LABELS: Record<string, string> = { Rewards_Management: "Rewards Management" };
function groupLabel(name: string) { return GROUP_LABELS[name] ?? name; }

export default function PermissionsPage() {
  const data = useFetch<PermData>("/api/permissions");
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    if (data.data) {
      const next: Record<string, Set<string>> = {};
      for (const g of data.data.groups) next[g.id] = new Set(g.permissions.map((p) => p.key));
      setSelected(next);
    }
  }, [data.data]);

  function toggle(groupId: string, key: string) {
    setSelected((s) => {
      const next = { ...s };
      const set = new Set(next[groupId] ?? []);
      if (set.has(key)) set.delete(key); else set.add(key);
      next[groupId] = set;
      return next;
    });
  }
  async function save(groupId: string, groupName: string) {
    setMsg(""); setErr(""); setSaving(groupId);
    const keys = Array.from(selected[groupId] ?? []);
    const res = await api("/api/permissions", "POST", { groupId, keys });
    setSaving("");
    if (!res.ok) setErr(res.error);
    else { setMsg("Permissions saved for " + groupLabel(groupName) + "."); data.reload(); }
  }
  const groups = data.data?.groups ?? [];
  const allKeys = data.data?.allKeys ?? [];
  return (
    <div>
      <PageHead title="Permissions" sub="Granular permission groups: Owner, Executive, Administration, Moderation, Development, Support, Rewards Management. The Owner group always has full control." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      {groups.length === 0 && !data.loading ? <p className="muted">No permission groups yet. Run the seed script to create the seven groups.</p> : null}
      {groups.map((g) => (
        <Card key={g.id} title={groupLabel(g.name) + " (" + g._count.members + " members)"}>
          {g.name === "Owner" ? <p className="muted">Owner has full control by design; its stored keys are informational.</p> : null}
          <table className="table">
            <thead><tr><th>Permission</th><th>Granted</th></tr></thead>
            <tbody>
              {allKeys.map((k) => (
                <tr key={k}>
                  <td><code>{k}</code></td>
                  <td>
                    <input type="checkbox" checked={selected[g.id]?.has(k) ?? false} onChange={() => toggle(g.id, k)} disabled={g.name === "Owner"} aria-label={k + " for " + g.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.name !== "Owner" ? (
            <div style={{ marginTop: 12 }}>
              <Btn kind="primary" disabled={saving === g.id} onClick={() => save(g.id, g.name)}>
                {saving === g.id ? "Saving..." : "Save " + groupLabel(g.name)}
              </Btn>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
