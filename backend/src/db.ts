import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export type UserRole = "admin" | "viewer";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface AppConfigRow {
  base_url: string;
  token: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO app_config (id, base_url, token) VALUES (1, '', '');
`;

export interface OpenDbOptions {
  path?: string;
  seedAdmin?: { username: string; password: string } | null;
  seedViewer?: { username: string; password: string } | null;
}

// Opens (and if needed, initializes + seeds) the app's own SQLite
// database. This is entirely separate from the Technitium DNS server —
// it only ever stores this dashboard's users, sessions, and the one
// admin-managed Technitium connection config. Nothing here is written
// to or read from the DNS server itself.
export function openDb(options: OpenDbOptions = {}): Database.Database {
  const dbPath = options.path ?? process.env.DB_PATH ?? "./data/resolvr.db";
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const seed = options.seedAdmin !== undefined
    ? options.seedAdmin
    : process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD
      ? { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }
      : null;

  // A seeded viewer is optional — most self-hosted installs just want
  // the one admin account and add viewers later from the Users page.
  // Set VIEWER_USERNAME/VIEWER_PASSWORD to also get one out of the box
  // (e.g. for demos, or a household member who should only ever see
  // the monitoring pages).
  const viewerSeed = options.seedViewer !== undefined
    ? options.seedViewer
    : process.env.VIEWER_USERNAME && process.env.VIEWER_PASSWORD
      ? { username: process.env.VIEWER_USERNAME, password: process.env.VIEWER_PASSWORD }
      : null;

  if (seed) {
    const userCount = db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
    if (userCount.n === 0) {
      const hash = bcrypt.hashSync(seed.password, 10);
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(seed.username, hash);

      if (viewerSeed) {
        const viewerHash = bcrypt.hashSync(viewerSeed.password, 10);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')").run(
          viewerSeed.username,
          viewerHash,
        );
      }
    }
  }

  return db;
}
