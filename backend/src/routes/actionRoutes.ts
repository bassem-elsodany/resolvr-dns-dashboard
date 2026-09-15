import { Router } from "express";
import type { Database } from "better-sqlite3";
import { callTechnitiumAction } from "../technitiumAction.js";
import type { AppConfigRow } from "../db.js";

export interface ActionRoutesOptions {
  fetchImpl?: typeof fetch;
}

function requireConfig(db: Database): AppConfigRow | null {
  const config = db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get() as AppConfigRow;
  return config.base_url && config.token ? config : null;
}

// Admin-only mutating actions — the one deliberate exception to this
// dashboard's read-only design. Each route hardcodes exactly one
// Technitium API call (see APIDOCS.md: Flush DNS Cache, Force Update
// Block Lists, Delete Session); none of them accept a caller-supplied
// path, so they can't be turned into a general write proxy.
export function actionRoutes(db: Database, options: ActionRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const router = Router();

  router.post("/flush-cache", async (_req, res) => {
    const config = requireConfig(db);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(config.base_url, config.token, "/cache/flush", {}, fetchImpl);
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/update-block-lists", async (_req, res) => {
    const config = requireConfig(db);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/settings/forceUpdateBlockLists",
      {},
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  // Lets an admin amend the block-list feed subscriptions shown on the
  // Blocked Zones page (see BlockedZonesView.vue), not just view them.
  // urls is the raw list as Technitium stores it — comment lines (e.g.
  // "# Hagezi PRO++") and URLs both, in order — sent back as one
  // comma-separated string per /api/settings/set's contract. An empty
  // list is sent as the literal "false", which is how that endpoint
  // documents clearing the value entirely.
  router.put("/block-list-urls", async (req, res) => {
    const { urls } = req.body ?? {};
    if (!Array.isArray(urls) || !urls.every((u) => typeof u === "string")) {
      res.status(400).json({ error: "urls must be an array of strings" });
      return;
    }
    const config = requireConfig(db);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const value = urls.length === 0 ? "false" : urls.join(",");
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/settings/set",
      { blockListUrls: value },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/revoke-session", async (req, res) => {
    const { partialToken } = req.body ?? {};
    if (typeof partialToken !== "string" || !partialToken) {
      res.status(400).json({ error: "partialToken is required" });
      return;
    }
    const config = requireConfig(db);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/admin/sessions/delete",
      { partialToken },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  return router;
}
