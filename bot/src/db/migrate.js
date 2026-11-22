import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./mysql.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS core_migrations (
      name VARCHAR(190) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((name) => /^\\d+_[a-z0-9_-]+\\.sql$/i.test(name))
    .sort();

  for (const name of files) {
    const [applied] = await pool.execute("SELECT name FROM core_migrations WHERE name = ?", [name]);
    if (applied.length) continue;

    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
    const connection = await pool.getConnection();
    try {
      for (const statement of statements) await connection.query(statement);
      await connection.execute("INSERT INTO core_migrations (name) VALUES (?)", [name]);
      console.log("[Database] Applied migration " + name);
    } catch (error) {
      console.error("[Database] Migration failed: " + name, error.message);
      throw error;
    } finally {
      connection.release();
    }
  }
}
