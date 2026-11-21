"use client";
import { useFetch, PageHead, Stat, Card, Err, Loading, fmtDate } from "../components/ui";

interface Stats {
  members: number;
  openTickets: number;
  pendingClaims: number;
  pendingSubmissions: number;
  pointsToday: number;
  checkinsToday: number;
  joinsToday: number;
  pointsByCategory: { category: string; total: number }[];
}
interface AuditRow { id: string; actorId: string | null; action: string; entityType: string | null; createdAt: string; }

export const dynamic = "force-dynamic";

export default function Overview() {
  const stats = useFetch<Stats>("/api/stats");
  const audit = useFetch<AuditRow[]>("/api/audit?take=10");
  const s = stats.data;
  const maxCat = Math.max(1, ...(s?.pointsByCategory ?? []).map((c) => c.total));
  return (
    <div>
      <PageHead title="Overview" sub="Live statistics from the Overland Core database." />
      {stats.error ? <Err msg={stats.error} /> : null}
      {stats.loading && !s ? <Loading /> : null}
      <div className="grid">
        <Stat label="Members" value={s?.members ?? 0} />
        <Stat label="Open tickets" value={s?.openTickets ?? 0} />
        <Stat label="Pending reward claims" value={s?.pendingClaims ?? 0} />
        <Stat label="Pending submissions" value={s?.pendingSubmissions ?? 0} />
        <Stat label="Points awarded today" value={s?.pointsToday ?? 0} />
        <Stat label="Check-ins today" value={s?.checkinsToday ?? 0} />
        <Stat label="New members today" value={s?.joinsToday ?? 0} />
      </div>
      <Card title="Points awarded by category (lifetime, positive awards)">
        {!s || s.pointsByCategory.length === 0 ? (
          <p className="muted">No point transactions recorded yet.</p>
        ) : (
          s.pointsByCategory.map((c) => (
            <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ width: 140, textTransform: "capitalize" }}>{c.category}</span>
              <div style={{ flex: 1, background: "#0B0F0E", borderRadius: 4, overflow: "hidden" }}>
                <div className="bar" style={{ width: Math.max(2, (c.total / maxCat) * 100) + "%" }} />
              </div>
              <span style={{ width: 80, textAlign: "right" }}>{c.total.toLocaleString()}</span>
            </div>
          ))
        )}
      </Card>
      <Card title="Recent audit activity">
        {audit.loading ? <Loading /> : null}
        {audit.error ? <p className="muted">{audit.error}</p> : null}
        {audit.data && audit.data.length === 0 ? <p className="muted">No audit entries yet.</p> : null}
        {audit.data && audit.data.length > 0 ? (
          <table className="table">
            <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead>
            <tbody>
              {audit.data.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.createdAt)}</td>
                  <td>{a.action}</td>
                  <td>{a.entityType ?? "n/a"}</td>
                  <td className="muted">{a.actorId ?? "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
