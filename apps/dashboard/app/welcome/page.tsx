"use client";
import { useEffect, useState } from "react";
import { useFetch, api, PageHead, Card, Btn, Field, Err, Loading } from "../../components/ui";

interface ConfigRow { key: string; value: unknown }

export default function WelcomePage() {
  const data = useFetch<ConfigRow[]>("/api/config");
  const [welcome, setWelcome] = useState({ enabled: true, dmEnabled: false, channelId: "", message: "" });
  const [verification, setVerification] = useState({ minAccountAgeDays: 7, requireCaptcha: true });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (data.data) {
      const find = (k: string) => (data.data as ConfigRow[]).find((r) => r.key === k)?.value as Record<string, unknown> | undefined;
      const w = find("welcome");
      if (w) setWelcome({ enabled: w.enabled !== false, dmEnabled: Boolean(w.dmEnabled), channelId: String(w.channelId ?? ""), message: String(w.message ?? "") });
      const v = find("verification");
      if (v) setVerification({ minAccountAgeDays: Number(v.minAccountAgeDays ?? 7), requireCaptcha: v.requireCaptcha !== false });
    }
  }, [data.data]);

  async function save(key: string, value: Record<string, unknown>, label: string) {
    setMsg(""); setErr("");
    const res = await api("/api/config", "POST", { key, value });
    if (!res.ok) setErr(res.error);
    else { setMsg(label); data.reload(); }
  }
  return (
    <div>
      <PageHead title="Welcome and Verification" sub="Welcome message, verification requirements, minimum account age and CAPTCHA challenge settings." />
      {err ? <Err msg={err} /> : null}
      {msg ? <div className="ok">{msg}</div> : null}
      {data.loading ? <Loading /> : null}
      {data.error ? <Err msg={data.error} /> : null}
      <Card title="Welcome">
        <label className="checkbox-row"><input type="checkbox" checked={welcome.enabled} onChange={(e) => setWelcome({ ...welcome, enabled: e.target.checked })} /> Welcome messages enabled</label>
        <label className="checkbox-row"><input type="checkbox" checked={welcome.dmEnabled} onChange={(e) => setWelcome({ ...welcome, dmEnabled: e.target.checked })} /> Send welcome DM</label>
        <Field label="Welcome channel ID"><input className="input" value={welcome.channelId} onChange={(e) => setWelcome({ ...welcome, channelId: e.target.value })} placeholder="Discord channel ID" /></Field>
        <Field label="Welcome message"><textarea className="input" rows={4} value={welcome.message} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} placeholder="Welcome to Overland Finance, {user}..." /></Field>
        <Btn kind="primary" onClick={() => save("welcome", welcome, "Welcome settings saved.")}>Save welcome settings</Btn>
      </Card>
      <Card title="Verification">
        <p className="muted">Successful verification grants the Citizen role. Account age checks, CAPTCHA and anti-raid limits are enforced by the bot from these settings.</p>
        <div className="form-row">
          <Field label="Minimum account age (days)"><input className="input" type="number" min={0} value={verification.minAccountAgeDays} onChange={(e) => setVerification({ ...verification, minAccountAgeDays: Number(e.target.value) })} /></Field>
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={verification.requireCaptcha} onChange={(e) => setVerification({ ...verification, requireCaptcha: e.target.checked })} /> Require CAPTCHA / verification challenge</label>
        <Btn kind="primary" onClick={() => save("verification", verification, "Verification settings saved.")}>Save verification settings</Btn>
      </Card>
    </div>
  );
}
