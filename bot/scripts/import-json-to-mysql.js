import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/db/mysql.js";
import { runMigrations } from "../src/db/migrate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "overland.json");
const apply = process.argv.includes("--apply");

async function main() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const database = JSON.parse(raw);
  if (!database || typeof database.guilds !== "object" || Array.isArray(database.guilds)) {
    throw new Error("The JSON file does not contain a valid guilds object.");
  }

  const entries = Object.entries(database.guilds);
  console.log("[Import] Mode: " + (apply ? "APPLY" : "DRY RUN"));
  console.log("[Import] Source: " + DATA_FILE);
  console.log("[Import] Guild records found: " + entries.length);

  await runMigrations();
  const pool = getPool();
  let existing = 0;
  for (const [guildId] of entries) {
    const [rows] = await pool.execute("SELECT guild_id FROM guild_state WHERE guild_id = ?", [guildId]);
    if (rows.length) existing++;
  }
  console.log("[Import] Existing destination records (will not be overwritten): " + existing);
  console.log("[Import] New records eligible for import: " + (entries.length - existing));

  if (!apply) {
    console.log("[Import] Nothing was written. Review the counts, then rerun with --apply.");
    return;
  }

  let inserted = 0;
  let skipped = 0;
  for (const [guildId, guildData] of entries) {
    const [result] = await pool.execute(
      "INSERT IGNORE INTO guild_state (guild_id, data, revision) VALUES (?, ?, 1)",
      [guildId, JSON.stringify(guildData)],
    );
    if (result.affectedRows === 1) inserted++;
    else skipped++;
  }
  console.log("[Import] Complete. Inserted: " + inserted + "; skipped existing: " + skipped + ".");
  console.log("[Import] The original JSON file was not changed or deleted.");
}

main().catch((error) => {
  console.error("[Import] Failed:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
