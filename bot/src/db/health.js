import { pingDatabase } from "./mysql.js";

export async function databaseHealth() {
  try {
    await pingDatabase();
    return { status: "ok", driver: "mysql" };
  } catch (error) {
    return { status: "error", driver: "mysql", message: error.message };
  }
}
