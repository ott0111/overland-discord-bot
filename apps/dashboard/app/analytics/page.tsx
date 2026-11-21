"use client";
import { useFetch, PageHead, Card, Err, Loading } from "../../components/ui";

interface Stats {
  members: number;
  pointsToday: number;
  checkinsToday: number;
  joinsToday: number;
  pointsByCategory: { category: string; total: number }[];
  daily: { date: string; checkins: number; joins: number; points: number }[];
}

function BarTable({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="muted">No data yet.</p> : rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ width: 110 }}>{r.label}</span>
          <div style={{ flex: 1, background: "#0B0F0E", borderRadius: 4, overflow: "hidden" }}>
            <div className="bar bar-lime" style={{ width: Math.max(2, (r.value / max) * 100) + "%" }} />
          </div>
          <span style={{ width: 70, textAlign: "right" }}>{r.value.toLocaleString()}</span>
        </div>
      ))}
    </Card>
  );
}

export default function AnalyticsPage() {
  const stats = useFetch<Stats>("/api/stats");
  const s = stats.data;
  const daily = s?.daily ?? [];
  return (
    <div>
      <PageHead title="Analytics" sub="Growth, engagement, earning and moderation trends for the last 14 days. Simple bar tables, no external chart library." />
      {stats.error ? <Err msg={stats.error} /> : null}
      {stats.loading ? <Loading /> : null}
      <BarTable title="Daily check-ins (last 14 days)" rows={daily.map((d) => ({ label: d.date.slice(5), value: d.checkins }))} />
      <BarTable title="New members per day (last 14 days)" rows={daily.map((d) => ({ label: d.date.slice(5), value: d.joins }))} />
      <BarTable title="Points awarded per day (last 14 days)" rows={daily.map((d) => ({ label: d.date.slice(5), value: d.points }))} />
      <BarTable title="Points by category (lifetime)" rows={(s?.pointsByCategory ?? []).map((c) => ({ label: c.category, value: c.total }))} />
      <Card title="Totals">
        <p>Total members: <strong>{s?.members ?? 0}</strong></p>
        <p>Points awarded today: <strong>{s?.pointsToday ?? 0}</strong></p>
        <p>Check-ins today: <strong>{s?.checkinsToday ?? 0}</strong></p>
        <p>New members today: <strong>{s?.joinsToday ?? 0}</strong></p>
      </Card>
    </div>
  );
}
