import { Router } from "express";
import type { Database } from "better-sqlite3";
import { requireAdmin, type AuthedRequest } from "../auth.js";
import { pingTechnitium } from "../technitiumPing.js";
import { listExtraServers, getPrimary, getServer } from "../servers.js";
import { logger, clean } from "../logger.js";

export interface ServerRoutesOptions {
  fetchImpl?: typeof fetch;
  // The primary connection is set outside the app (the Home Assistant
  // add-on's Configuration tab): it can be renamed but not re-pointed or
  // removed from here.
  managed?: boolean;
}

const MAX_NAME = 80;

interface ServerView {
  id: number;
  name: string;
  baseUrl: string;
  primary: boolean;
  configured: boolean;
  managed: boolean;
}

// The Technitium servers Resolvr can observe. Id 0 is the first connection
// (stored in app_config, which the add-on and older versions also use); the
// rest live in `servers`. To the user they are all just servers: each can be
// renamed and removed. Listing is open to every signed-in user so the server
// switcher works for viewers; tokens never leave the backend and changes are
// admin-only.
export function serverRoutes(db: Database, options: ServerRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const managed = Boolean(options.managed);
  const router = Router();

  const view = (id: number, name: string, baseUrl: string): ServerView => ({
    id,
    name,
    baseUrl,
    primary: id === 0,
    configured: true,
    managed: id === 0 && managed,
  });

  // Viewers get the names, which is all the switcher needs; the addresses are
  // internal details only admins see (as with /api/config).
  router.get("/", (req, res) => {
    const isAdmin = (req as AuthedRequest).user?.role === "admin";
    const primary = getPrimary(db);
    const servers: ServerView[] = [];
    if (primary.base_url && primary.token) servers.push(view(0, primary.name, primary.base_url));
    for (const s of listExtraServers(db)) servers.push(view(s.id, s.name, s.base_url));
    res.json({ servers: isAdmin ? servers : servers.map((s) => ({ ...s, baseUrl: "" })) });
  });

  function readConnection(body: unknown): { baseUrl: string; token: string } | null {
    const { baseUrl, token } = (body ?? {}) as Record<string, unknown>;
    if (typeof baseUrl !== "string" || !baseUrl.trim() || typeof token !== "string" || !token.trim()) return null;
    return { baseUrl: baseUrl.trim().replace(/\/+$/, ""), token: token.trim() };
  }

  function readName(body: unknown): string | { error: string } {
    const { name } = (body ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return { error: "name is required" };
    if (name.trim().length > MAX_NAME) return { error: `name must be at most ${MAX_NAME} characters` };
    return name.trim();
  }

  // Checks a URL and token against Technitium without saving anything, so the
  // form can say "this works" before the admin adds it.
  router.post("/test", requireAdmin, async (req, res) => {
    const connection = readConnection(req.body);
    if (!connection) {
      res.status(400).json({ error: "baseUrl and token are required" });
      return;
    }
    const result = await pingTechnitium(connection.baseUrl, connection.token, fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    res.json({ status: "ok", serverDomain: result.serverDomain, serverVersion: result.serverVersion });
  });

  // Checks a saved server with the URL and token it already has, so any row
  // can be tested without typing the token again.
  router.post("/:id/test", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const server = Number.isInteger(id) && id >= 0 ? getServer(db, id) : null;
    if (!server || !server.base_url || !server.token) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    const result = await pingTechnitium(server.base_url, server.token, fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    res.json({ status: "ok", serverDomain: result.serverDomain, serverVersion: result.serverVersion });
  });

  router.post("/", requireAdmin, async (req, res) => {
    const name = readName(req.body);
    if (typeof name !== "string") {
      res.status(400).json(name);
      return;
    }
    const connection = readConnection(req.body);
    if (!connection) {
      res.status(400).json({ error: "baseUrl and token are required" });
      return;
    }
    const result = await pingTechnitium(connection.baseUrl, connection.token, fetchImpl);
    if (!result.ok) {
      logger.warn(`Technitium connection check failed for ${clean(connection.baseUrl, 200)}: ${result.error ?? "unknown error"}`);
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    // The first server added (or the first again after the primary was
    // removed) becomes the primary, so a fresh install and older clients that
    // send no server header keep working.
    const primary = getPrimary(db);
    let id = 0;
    if (!primary.base_url && !managed) {
      db.prepare("UPDATE app_config SET name = ?, base_url = ?, token = ? WHERE id = 1").run(name, connection.baseUrl, connection.token);
    } else {
      id = Number(db.prepare("INSERT INTO servers (name, base_url, token) VALUES (?, ?, ?)").run(name, connection.baseUrl, connection.token).lastInsertRowid);
    }
    logger.info(`Technitium server added: ${clean(name, 80)} at ${clean(connection.baseUrl, 200)} (${clean(result.serverDomain)})`);
    res.status(201).json(view(id, name, connection.baseUrl));
  });

  // Renames a server, and optionally points it at a new URL and token (both
  // together, checked against Technitium first). Renaming alone needs no token.
  router.put("/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const current = Number.isInteger(id) && id >= 0 ? getServer(db, id) : null;
    if (!current || (id === 0 && !current.base_url)) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    const name = readName(req.body);
    if (typeof name !== "string") {
      res.status(400).json(name);
      return;
    }
    let nextUrl = current.base_url;
    let nextToken = current.token;
    const { baseUrl, token } = (req.body ?? {}) as Record<string, unknown>;
    if (baseUrl !== undefined || token !== undefined) {
      if (id === 0 && managed) {
        res.status(409).json({ error: "This connection is set in the add-on's Configuration tab. Change it there and restart the add-on." });
        return;
      }
      const connection = readConnection(req.body);
      if (!connection) {
        res.status(400).json({ error: "baseUrl and token must be given together" });
        return;
      }
      const result = await pingTechnitium(connection.baseUrl, connection.token, fetchImpl);
      if (!result.ok) {
        res.status(400).json({ error: result.error ?? "Could not connect to the server" });
        return;
      }
      nextUrl = connection.baseUrl;
      nextToken = connection.token;
    }
    if (id === 0) db.prepare("UPDATE app_config SET name = ?, base_url = ?, token = ? WHERE id = 1").run(name, nextUrl, nextToken);
    else db.prepare("UPDATE servers SET name = ?, base_url = ?, token = ? WHERE id = ?").run(name, nextUrl, nextToken, id);
    res.json(view(id, name, nextUrl));
  });

  router.delete("/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 0) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    if (id === 0) {
      const primary = getPrimary(db);
      if (!primary.base_url) {
        res.status(404).json({ error: "Unknown Technitium server." });
        return;
      }
      if (managed) {
        res.status(409).json({ error: "This connection is set in the add-on's Configuration tab. Remove it there and restart the add-on." });
        return;
      }
      db.prepare("UPDATE app_config SET name = '', base_url = '', token = '' WHERE id = 1").run();
      logger.info("Technitium primary server removed");
      res.json({ status: "ok" });
      return;
    }
    const info = db.prepare("DELETE FROM servers WHERE id = ?").run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    logger.info(`Technitium server ${id} removed`);
    res.json({ status: "ok" });
  });

  return router;
}
