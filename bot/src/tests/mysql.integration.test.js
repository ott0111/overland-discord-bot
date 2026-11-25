import test from "node:test";
import assert from "node:assert/strict";
import { runMigrations } from "../db/migrate.js";
import { getPool, closePool } from "../db/mysql.js";
import { listConfiguration, setConfiguration, appendAuditLog, listAuditLogs, getNormalizedOverview } from "../db/repositories/operations.js";
import { createRole, listRoles, grantMemberRole, evaluateMemberRoles } from "../db/repositories/roles.js";
import { createModerationAction, listModerationActions } from "../db/repositories/moderation.js";

const enabled = process.env.RUN_MYSQL_INTEGRATION_TESTS === "1";
const databaseName = process.env.DATABASE_NAME || "";
const guildId = String(BigInt(Date.now()) + 10000000000000000n).slice(0, 20);
const userId = String(BigInt(Date.now()) + 20000000000000000n).slice(0, 20);

test("normalized MySQL migrations and repositories work against an isolated test database", { skip: !enabled }, async () => {
  assert.match(databaseName, /(^|_)(test|testing|ci)(_|$)/i, "Refusing integration tests unless DATABASE_NAME clearly identifies a test database");
  assert.ok(process.env.DATABASE_HOST, "DATABASE_HOST is required");
  try {
    await runMigrations();
    const pool = getPool();
    const [migrations] = await pool.execute("SELECT name FROM core_migrations ORDER BY name");
    assert.ok(migrations.length >= 7, "all currently numbered migrations should be applied");

    const saved = await setConfiguration(guildId, "integration-test", { enabled: true, count: 3 }, userId);
    assert.equal(saved.key, "integration-test");
    const config = await listConfiguration(guildId);
    assert.equal(config.find((row) => row.key === "integration-test")?.value?.enabled, true);

    const audit = await appendAuditLog(guildId, { actorId: userId, action: "integration.test", entityType: "Test", entityId: "run", details: { ok: true } });
    const auditRows = await listAuditLogs(guildId, 10);
    assert.ok(auditRows.some((row) => row.id === audit.id && row.details.ok === true));

    const role = await createRole(guildId, { name: "Integration Citizen", description: "Temporary test role", discordRoleId: null, config: { requireVerified: false } });
    assert.ok((await listRoles(guildId)).some((row) => row.id === role.id));
    const granted = await grantMemberRole(guildId, { id: userId, username: "Integration Tester" }, role.name, userId);
    assert.equal(granted, true);
    assert.deepEqual(await evaluateMemberRoles(guildId, { id: userId, username: "Integration Tester" }), []);

    const action = await createModerationAction(guildId, {
      action: "WARN",
      target: { id: userId, username: "Integration Tester", tag: "Integration Tester" },
      actorId: userId,
      reason: "Integration test only",
    });
    assert.equal(action.caseId, 1);
    assert.ok((await listModerationActions(guildId, 10)).some((row) => row.id === action.id));

    const overview = await getNormalizedOverview(guildId);
    assert.equal(overview.db, "ok");
    assert.equal(typeof overview.members, "number");
  } finally {
    await closePool();
  }
});
