import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env.js";

export function openDatabase(): Database.Database {
  const dbPath = env.DATABASE_URL.replace(/^file:/, "");
  const dbDir = path.dirname(dbPath);

  fs.mkdirSync(dbDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  return db;
}
