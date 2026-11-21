"use client";
import { useFetch, PageHead, Card, Stat, Err, Loading, fmtDate } from "../../components/ui";

interface Referral {
  id: string; inviteCode: string; verified: boolean; retained7d: boolean; becameComrade: boolean; suspicious: boolean; createdAt: string;
  referrer: { user: { username: string; discordId: string } };
  referred: { user: { username: string; discordId: string } };
}
interface RefData { referrals: Referral[]; stats: { total: number; verified: number; retained: number; comrade: number; suspicious: number }; }

export default function ReferralsPage() {
  const data = useFetch<RefData>("/api/referrals");
  const s = data.data?.stats ?? { total: 0, verified: 0, retained: 0, comrade: 0, suspicious: 0 };
  const items = data.data?.referrals ?? [];
  return (
    <div>
      <PageHead title="Referrals" sub="Referral leaderboard, verification status, 7-day retention and Comrade conversions, suspicious pattern flags. Self-referrals are blocked and duplicate rewards are prevented by a unique referrer/referred pair." />
      {data.error ? <Err msg={data.error} /> : null}
      {data.loading ? <Loading /> : null}
      <div className="grid">
        <Stat label="Total referrals" value={s.total} />
        <Stat label="Verified" value={s.verified} />
        <Stat label="Retained 7 days" value={s.retained} />
        <Stat label="Became Comrade" value={s.comrade} />
        <Stat label="Flagged suspicious" value={s.suspicious} />
      </div>
      <Card title={"Referrals (" + items.length + ")"}>
        {items.length === 0 && !data.loading ? <p className="muted">No referrals recorded yet. Invite tracking is documented in the bot: joins are matched to invite codes, and a referral only pays after verification.</p> : null}
        {items.length > 0 ? (
          <table className="table">
            <thead><tr><th>Referrer</th><th>Referred</th><th>Invite code</th><th>Verified</th><th>Retained 7d</th><th>Comrade</th><th>Flagged</th><th>When</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.referrer.user.username}</td>
                  <td>{r.referred.user.username}</td>
                  <td><code>{r.inviteCode}</code></td>
                  <td>{r.verified ? "Yes" : "No"}</td>
                  <td>{r.retained7d ? "Yes" : "No"}</td>
                  <td>{r.becameComrade ? "Yes" : "No"}</td>
                  <td>{r.suspicious ? <span className="badge badge-red">suspicious</span> : "No"}</td>
                  <td className="muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
