import mysql from "mysql2/promise";

let pool;

function databaseConfig() {
  const urlValue = process.env.DATABASE_URL;
  let fromUrl = {};
  if (urlValue) {
    const url = new URL(urlValue);
    if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use the mysql:// protocol.");
    fromUrl = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
  }

  const config = {
    host: process.env.DATABASE_HOST || fromUrl.host,
    port: Number(process.env.DATABASE_PORT || fromUrl.port || 3306),
    user: process.env.DATABASE_USER || fromUrl.user,
    password: process.env.DATABASE_PASSWORD ?? fromUrl.password,
    database: process.env.DATABASE_NAME || fromUrl.database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE || 5),
    maxIdle: Number(process.env.DATABASE_POOL_SIZE || 5),
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };

  for (const key of ["host", "user", "database"]) {
    if (!config[key]) throw new Error("Missing MySQL configuration: set DATABASE_" + key.toUpperCase() + ".");
  }
  if (config.password === undefined) throw new Error("Missing MySQL configuration: set DATABASE_PASSWORD.");
  if (process.env.DATABASE_SSL === "true") {
    config.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
  }
  return config;
}

export function getPool() {
  if (!pool) pool = mysql.createPool(databaseConfig());
  return pool;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export async function pingDatabase() {
  const [rows] = await getPool().query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
