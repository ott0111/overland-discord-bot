"use client";
import { useEffect, useState } from "react";
import { DEFAULT_POINT_VALUES, DAILY_LIMITS } from "@overland/shared";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading, fmtDate } from "../../components/ui";

interface Tx { id: string; currency: string; category: string; amount: number; balanceAfter: number; source: string; reason: string | null; createdAt: string; member: { user: { username: string } }; }
interface PointsData { transactions: Tx[]; pointValues: Record<string, Record<string, number>>; dailyLimits: Record<string, number>; }

type Values = Record<string, Record<string, number>>;
function defaults(): Values {
  const out: Values = {};
  for (const [cat, vals] of Object.entries(DEFAULT_POINT_VALUES)) out[cat] = { ...(vals as Record<string, number>) };
  return out;
}

export default function PointsPage() {
  const data = useFetch<PointsData>("/api/points");
  const [values, setValues] = useState<Values>(defaults());
  const [limits, setLimits] = useState<{ overpoints: number; overcredits: number; messagesRewarded: number }>({ overpoints: DAILY_LIMITS.overpoints, overcredits: DAILY_LIMITS.overcredits, messagesRewarded: DAILY_LIMITS.messagesRewarded });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [adj, setAdj] = useState({ memberRef: "", currency: "OVERPOINTS", amount: "", reason: "" });

  useEffect(() => {
    if (data.data) {
      const pv = data.data.pointValues;
      if (pv && Object.keys(pv).length > 0) {
        const merged = defaults();
        for (const [cat, vals] of Object.entries(pv)) {
          if (vals && typeof vals === "object") merged[cat] = { ...(merged[cat] ?? {}), ...(vals as Record<string, number>) };
        }
        setValues(merged);
      }
      const dl = data.data.dailyLimits;
      if (dl && Object.keys(dl).length > 0) {
        setLimits({
          overpoints: Number(dl.overpoints ?? DAILY_LIMITS.overpoints),
          overcredits: Number(dl.overcredits ?? DAILY_LIMITS.overcredits),
          messagesRewarded: Number(dl.messagesRewarded ?? DAILY_LIMITS.messagesRewarded),
        });
      }
    }
  }, [data.data]);

  async function saveValues() {
    setMsg(""); setErr("");
    const r1 = await api("/api/config", "POST", { key: "pointValues", value: values });
    const r2 = await api("/api/config", "POST", { key: "dailyLimits", value: limits });
    if (!r1.ok) setErr(r1.error);
    else if (!r2.ok) setErr(r2.error);
    else { setMsg("Point values and daily limits saved."); data.reload(); }
  }
  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const res = await api("/api/points", "POST", { memberRef: adj.memberRef.trim(), currency: adj.currency, amount: Number(adj.amount), reason: adj.reason || undefined });
    if (!res.ok) setErr(res.error);
    else { setMsg("Adjustment applied. Negative balances are rejected, so this never overdraws a member."); setAdj({ memberRef: "", currency: "OVERPOINTS", amount: "", reason: "" }); data.reload(); }
  }
  const txs = data.data?.transactions ?? [];
  return (
    <div>
      <PageHead title="Points and Economy" sub="Overpoints (lifetime, never spent) and Overcredits (redeemable). Point values per earning category, daily limits and admin adjustments. Every adjustment writes an audited transaction." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title="Point values (per earning category)">
        {Object.entries(values).map(([cat, vals]) => (
          <div key={cat} style={{ marginBottom: 16 }}>
            <h3 style={{ textTransform: "capitalize", margin: "0 0 8px" }}>{cat}</h3>
            <div className="form-row">
              {Object.entries(vals).map(([k, v]) => (
                <Field key={k} label={k}>
                  <input className="input" type="number" value={v} onChange={(e) => setValues((prev) => ({ ...prev, [cat]: { ...prev[cat], [k]: Number(e.target.value) } }))} />
                </Field>
              ))}
            </div>
          </div>
        ))}
        <h3>Daily limits</h3>
        <div className="form-row">
          <Field label="Overpoints per day"><input className="input" type="number" min={0} value={limits.overpoints} onChange={(e) => setLimits({ ...limits, overpoints: Number(e.target.value) })} /></Field>
          <Field label="Overcredits per day"><input className="input" type="number" min={0} value={limits.overcredits} onChange={(e) => setLimits({ ...limits, overcredits: Number(e.target.value) })} /></Field>
          <Field label="Rewarded messages per day"><input className="input" type="number" min={0} value={limits.messagesRewarded} onChange={(e) => setLimits({ ...limits, messagesRewarded: Number(e.target.value) })} /></Field>
          <Btn kind="primary" onClick={saveValues}>Save point values and limits</Btn>
        </div>
      </Card>
      <Card title="Admin adjustment">
        <form onSubmit={adjust}>
          <div className="form-row">
            <Field label="Member Discord ID or member ID"><input className="input" value={adj.memberRef} onChange={(e) => setAdj({ ...adj, memberRef: e.target.value })} required /></Field>
            <Field label="Currency">
              <select className="input" value={adj.currency} onChange={(e) => setAdj({ ...adj, currency: e.target.value })}>
                <option value="OVERPOINTS">Overpoints</option>
                <option value="OVERCREDITS">Overcredits</option>
              </select>
            </Field>
            <Field label="Amount (negative to deduct)"><input className="input" type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} required /></Field>
            <Field label="Reason"><input className="input" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Why is this adjustment made?" /></Field>
            <Btn kind="primary" type="submit">Apply adjustment</Btn>
          </div>
        </form>
      </Card>
      <Card title={"Recent transactions (" + txs.length + ")"}>
        {txs.length === 0 ? <p className="muted">No transactions yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>Member</th><th>Currency</th><th>Category</th><th>Amount</th><th>Balance after</th><th>Source</th><th>Reason</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{fmtDate(t.createdAt)}</td>
                  <td>{t.member.user.username}</td>
                  <td>{t.currency}</td>
                  <td>{t.category}</td>
                  <td>{t.amount > 0 ? "+" : ""}{t.amount}</td>
                  <td>{t.balanceAfter}</td>
                  <td>{t.source}</td>
                  <td className="muted">{t.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
