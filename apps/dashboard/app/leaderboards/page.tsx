"use client";
import { useState } from "react";
import { useFetch, PageHead, Card, Err, Loading } from "../../components/ui";

interface Row { rank: number; username: string; discordId: string; score: number; }
const CATEGORIES = [
  { value: "overall", label: "Overall (Overpoints)" },
  { value: "community", label: "Community" },
  { value: "social", label: "Social" },
  { value: "referrals", label: "Referrals" },
  { value: "contributions", label: "Contributions" },
];

export default function LeaderboardsPage() {
  const [category, setCategory] = useState("overall");
  const [period, setPeriod] = useState("LIFETIME");
  const data = useFetch<Row[]>("/api/leaderboards?category=" + category + "&period=" + period);
  const rows = data.data ?? [];
  return (
    <div>
      <PageHead title="Leaderboards" sub="Overall, community, social, referral and contribution rankings, lifetime, monthly and weekly. Monthly and weekly rankings are computed from transactions, so lifetime statistics are never erased by a reset." />
      <Card>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <span>Category</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <span>Period</span>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="LIFETIME">Lifetime</option>
              <option value="MONTHLY">Monthly (last 30 days)</option>
              <option value="WEEKLY">Weekly (last 7 days)</option>
            </select>
          </div>
        </div>
      </Card>
      {data.error ? <Err msg={data.error} /> : null}
      {data.loading ? <Loading /> : null}
      <Card title={CATEGORIES.find((c) => c.value === category)?.label + " | " + (period === "LIFETIME" ? "Lifetime" : period === "MONTHLY" ? "Monthly" : "Weekly")}>
        {rows.length === 0 && !data.loading ? <p className="muted">No rankings yet for this view.</p> : null}
        {rows.length > 0 ? (
          <table className="table">
            <thead><tr><th>Rank</th><th>Member</th><th>Discord ID</th><th>Score</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.discordId + r.rank}>
                  <td><strong>{r.rank}</strong></td>
                  <td>{r.username}</td>
                  <td className="muted">{r.discordId}</td>
                  <td>{r.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
