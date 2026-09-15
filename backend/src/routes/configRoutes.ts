import { Router } from "express";
import type { Database } from "better-sqlite3";
import { pingTechnitium } from "../technitiumPing.js";
import type { AppConfigRow } from "../db.js";

export interface ConfigRoutesOptions {
  fetchImpl?: typeof fetch;
}

function getConfig(db: Database): AppConfigRow {
  return db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get() as AppConfigRow;
}

// Mounted twice: once under /api/status (any authenticated role) and
// once under /api/config (admin only, can also write). Kept as one
// router factory so both share the exact same read logic.
export function statusRoute(db: Database, options: ConfigRoutesOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (_req: unknown, res: import("express").Response) => {
    const config = getConfig(db);
    if (!config.base_url || !config.token) {
      res.json({ configured: false, connected: false, serverDomain: null, serverVersion: null });
      return;
    }
    const result = await pingTechnitium(config.base_url, config.token, fetchImpl);
    res.json({
      configured: true,
      connected: result.ok,
      serverDomain: result.serverDomain ?? null,
      serverVersion: result.serverVersion ?? null,
      error: result.ok ? null : result.error,
    });
  };
}

export function configRoutes(db: Database, options: ConfigRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const router = Router();

  router.get("/", (_req, res) => {
    const config = getConfig(db);
    res.json({ baseUrl: config.base_url, token: config.token });
  });

  router.put("/", async (req, res) => {
    const { baseUrl, token } = req.body ?? {};
    if (typeof baseUrl !== "string" || !baseUrl.trim() || typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "baseUrl and token are required" });
      return;
    }
    const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const cleanToken = token.trim();

    const result = await pingTechnitium(cleanBaseUrl, cleanToken, fetchImpl);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Could not connect to the server" });
      return;
    }

    db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run(cleanBaseUrl, cleanToken);
    res.json({ status: "ok", serverDomain: result.serverDomain, serverVersion: result.serverVersion });
  });

  return router;
}
