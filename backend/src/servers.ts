import type { Request } from "express";
import type { Database } from "better-sqlite3";

// A browser says which Technitium server a request is about with this header.
// Left out (or "0"), the request is about the primary connection, so older
// clients and the Home Assistant add-on keep working unchanged.
export const SERVER_HEADER = "x-resolvr-server";

export interface ServerConnection {
  // 0 is the primary connection (app_config); anything else is a row of `servers`.
  id: number;
  name: string;
  base_url: string;
  token: string;
}

interface ServerRow {
  id: number;
  name: string;
  base_url: string;
  token: string;
}

export function getPrimary(db: Database): ServerConnection {
  const row = db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get() as { base_url: string; token: string };
  return { id: 0, name: "", base_url: row.base_url, token: row.token };
}

export function getServer(db: Database, id: number): ServerConnection | null {
  if (id === 0) return getPrimary(db);
  const row = db.prepare("SELECT id, name, base_url, token FROM servers WHERE id = ?").get(id) as ServerRow | undefined;
  return row ?? null;
}

export function listExtraServers(db: Database): ServerConnection[] {
  return db.prepare("SELECT id, name, base_url, token FROM servers ORDER BY id").all() as ServerRow[];
}

// The id a request asks for: 0 when the header is absent, null when it is
// present but not a server id.
export function requestedServerId(req: Request): number | null {
  const raw = req.header(SERVER_HEADER);
  if (raw === undefined || raw.trim() === "") return 0;
  return /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

// The server a request is about, or null when it names one that does not
// exist. A server that exists but has no URL/token yet is returned as is, so
// callers can tell "not configured" from "unknown".
export function serverForRequest(db: Database, req: Request): ServerConnection | null {
  const id = requestedServerId(req);
  return id === null ? null : getServer(db, id);
}
