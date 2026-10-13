import { Router } from "express";
import type { Database } from "better-sqlite3";
import { requireAdmin } from "../auth.js";
import { pingTechnitium } from "../technitiumPing.js";
import { listExtraServers, getPrimary } from "../servers.js";
import { logger, clean } from "../logger.js";

export interface ServerRoutesOptions {
  fetchImpl?: typeof fetch;
}

const MAX_NAME = 80;

// The Technitium servers Resolvr can observe: the primary connection (id 0,
// set on the Connection Settings page or by the add-on) plus any added here.
// Listing is open to every signed-in user so the server switcher works for
// viewers; tokens never leave the backend, and changes are admin-only.
export function serverRoutes(db: Database, options: ServerRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const router = Router();

  router.get("/", (_req, res) => {
    const primary = getPrimary(db);
    const servers = [
      { id: 0, name: "", baseUrl: primary.base_url, primary: true, configured: Boolean(primary.base_url && primary.token) },
      ...listExtraServers(db).map((s) => ({ id: s.id, name: s.name, baseUrl: s.base_url, primary: false, configured: true })),
    ];
    res.json({ servers });
  });

  function readBody(body: unknown): { name: string; baseUrl: string; token: string } | string {
    const { name, baseUrl, token } = (body ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return "name is required";
    if (name.trim().length > MAX_NAME) return `name must be at most ${MAX_NAME} characters`;
    if (typeof baseUrl !== "string" || !baseUrl.trim() || typeof token !== "string" || !token.trim()) {
      return "baseUrl and token are required";
    }
    return { name: name.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ""), token: token.trim() };
  }

  router.post("/", requireAdmin, async (req, res) => {
    const parsed = readBody(req.body);
    if (typeof parsed === "string") {
      res.status(400).json({ error: parsed });
      return;
    }
    const result = await pingTechnitium(parsed.baseUrl, parsed.token, fetchImpl);
    if (!result.ok) {
      logger.warn(`Technitium connection check failed for ${clean(parsed.baseUrl, 200)}: ${result.error ?? "unknown error"}`);
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    const info = db
      .prepare("INSERT INTO servers (name, base_url, token) VALUES (?, ?, ?)")
      .run(parsed.name, parsed.baseUrl, parsed.token);
    logger.info(`Technitium server added: ${clean(parsed.name, 80)} at ${clean(parsed.baseUrl, 200)}`);
    res.status(201).json({ id: Number(info.lastInsertRowid), name: parsed.name, baseUrl: parsed.baseUrl, primary: false, configured: true });
  });

  router.put("/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    const parsed = readBody(req.body);
    if (typeof parsed === "string") {
      res.status(400).json({ error: parsed });
      return;
    }
    const exists = db.prepare("SELECT 1 FROM servers WHERE id = ?").get(id);
    if (!exists) {
      res.status(404).json({ error: "Unknown Technitium server." });
      return;
    }
    const result = await pingTechnitium(parsed.baseUrl, parsed.token, fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }
    db.prepare("UPDATE servers SET name = ?, base_url = ?, token = ? WHERE id = ?").run(parsed.name, parsed.baseUrl, parsed.token, id);
    res.json({ id, name: parsed.name, baseUrl: parsed.baseUrl, primary: false, configured: true });
  });

  router.delete("/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(404).json({ error: "Unknown Technitium server." });
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
