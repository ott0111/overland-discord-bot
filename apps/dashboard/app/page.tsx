"use client";
import { useFetch, Stat, Card, Err, Loading, fmtDate, fmtNum } from "../components/ui";

interface DailyPoint { date: string; checkins: number; joins: number; points: number; }
interface Stats {
  members: number; openTickets: number; pendingClaims: number; pendingSubmissions: number;
  pointsToday: number; checkinsToday: number; joinsToday: number;
  pointsByCategory: { category: string; total: number }[];
  daily: DailyPoint[]; db: string;
}
interface AuditRow { id: string; actorId: string | null; action: string; entityType: string | null; createdAt: string; }

export const dynamic = "force-dynamic";

export default function Overview() {
  const stats = useFetch<Stats>("/api/stats");
  const audit = useFetch<AuditRow[]>("/api/audit?take=10");
  const s = stats.data;
  const maxCat = Math.max(1, ...(s?.pointsByCategory ?? []).map((c) => c.total));
  const maxDaily = Math.max(1, ...(s?.daily ?? []).map((d) => d.joins + d.checkins));
  return (
    <div>
      <section className="overview-hero">
        <div className="overview-hero-copy">
          <div className="page-kicker">OVERLAND CORE / OPERATIONS</div>
          <h1>Community overview</h1>
          <p>Your command center for community health, member activity, rewards, and day-to-day operations.</p>
        </div>
        <div className="overview-hero-meta">
          <span className="live-chip"><span className="status-dot" /> {s?.db === "ok" ? "DATA SOURCE CONNECTED" : "CHECKING DATA SOURCE"}</span>
          <span className="overview-meta-note">UPDATED {s ? "JUST NOW" : "WHEN DATA LOADS"}</span>
        </div>
      </section>

      {stats.error ? <Err msg={stats.error} /> : null}
      {stats.loading && !s ? <Loading /> : null}

      <div className="section-heading"><h2>Community at a glance</h2><span>LIVE METRICS</span></div>
      <div className="grid">
        <Stat label="Total members" value={fmtNum(s?.members ?? 0)} />
        <Stat label="New members today" value={fmtNum(s?.joinsToday ?? 0)} />
        <Stat label="Daily check-ins" value={fmtNum(s?.checkinsToday ?? 0)} />
        <Stat label="Points awarded today" value={fmtNum(s?.pointsToday ?? 0)} />
        <Stat label="Open support tickets" value={fmtNum(s?.openTickets ?? 0)} />
        <Stat label="Pending reward claims" value={fmtNum(s?.pendingClaims ?? 0)} />
        <Stat label="Pending submissions" value={fmtNum(s?.pendingSubmissions ?? 0)} />
      </div>

      <div className="overview-columns">
        <Card title="Points distribution">
          <p className="muted" style={{ marginTop: -7, marginBottom: 18, fontSize: 10 }}>Lifetime positive point awards, grouped by category.</p>
          {!s || s.pointsByCategory.length === 0 ? <div className="empty-note">Point activity will appear here once transactions are recorded.</div> : s.pointsByCategory.slice(0, 8).map((c) => (
            <div className="category-row" key={c.category}>
              <span className="category-name">{c.category.replace(/_/g, " ")}</span>
              <div className="category-track"><div className="bar" style={{ width: Math.max(2, (c.total / maxCat) * 100) + "%" }} /></div>
              <span className="category-value">{fmtNum(c.total)}</span>
            </div>
          ))}
        </Card>

        <Card title="Community activity">
          <p className="muted" style={{ marginTop: -7, marginBottom: 18, fontSize: 10 }}>Member joins and check-ins over the last 14 days.</p>
          {!s || s.daily.length === 0 ? <div className="empty-note">Daily activity will appear here as the community grows.</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(14, minmax(0, 1fr))", alignItems: "end", gap: 5, height: 112, paddingTop: 8 }}>
              {s.daily.map((d) => {
                const height = Math.max(5, ((d.joins + d.checkins) / maxDaily) * 86);
                return <div key={d.date} title={d.date + ": " + d.joins + " joins, " + d.checkins + " check-ins"} style={{ height, borderRadius: "4px 4px 2px 2px", background: "linear-gradient(180deg, #c0e987, #658b3c)", opacity: d.joins + d.checkins ? 1 : .25 }} />;
              })}
            </div>
          )}
          <div className="overview-footer-note"><span className="status-dot" /> 14-DAY ACTIVITY WINDOW</div>
        </Card>
      </div>

      <div className="section-heading"><h2>Recent operations</h2><span>ADMIN AUDIT LOG</span></div>
      <Card title="Latest administrative activity">
        {audit.loading ? <Loading /> : null}
        {audit.error ? <p className="muted">{audit.error}</p> : null}
        {audit.data && audit.data.length === 0 ? <div className="audit-empty"><span className="audit-mark">--</span>No audit events have been recorded yet.</div> : null}
        {audit.data && audit.data.length > 0 ? (
          <div className="audit-table">
            <table className="table">
              <thead><tr><th>Timestamp</th><th>Action</th><th>Resource</th><th>Performed by</th></tr></thead>
              <tbody>{audit.data.map((a) => (
                <tr key={a.id}><td>{fmtDate(a.createdAt)}</td><td><span className="badge">{a.action}</span></td><td>{a.entityType ?? "System"}</td><td className="muted">{a.actorId ?? "Automated process"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </Card>
      <div className="overview-footer-note">OVERLAND CORE <span>•</span> COMMUNITY OPERATIONS</div>
    </div>
  );
}
