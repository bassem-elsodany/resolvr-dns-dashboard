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

  // Lets an admin add or remove individual domains from the Blocked
  // Zones list shown on BlockedZonesView.vue — the same domain-level
  // control Technitium's own web console offers (Blocked: Modify /
  // Delete permissions), distinct from the block-list-urls feeds
  // above: this adds/removes one specific domain directly.
  router.post("/block-domain", async (req, res) => {
    const { domain } = req.body ?? {};
    if (typeof domain !== "string" || !domain.trim()) {
      res.status(400).json({ error: "domain is required" });
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
      "/blocked/add",
      { domain: domain.trim() },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/unblock-domain", async (req, res) => {
    const { domain } = req.body ?? {};
    if (typeof domain !== "string" || !domain.trim()) {
      res.status(400).json({ error: "domain is required" });
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
      "/blocked/delete",
      { domain: domain.trim() },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  // Technitium's Apps API has no enable/disable toggle for an
  // installed app — only install, update, and uninstall exist (no
  // "disabled" field even appears in /api/apps/list). Uninstall is the
  // one real mutating action available for the Apps page.
  router.post("/uninstall-app", async (req, res) => {
    const { name } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
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
      "/apps/uninstall",
      { name: name.trim() },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  // Host-to-IP mapping (the AdGuard "DNS rewrites" equivalent). This
  // server's own zones show the pattern Technitium expects for it:
  // one Primary zone named exactly the hostname, with a single A/AAAA
  // record at its apex — so creating a mapping is a zone create
  // followed by a record add, and removing one is a zone delete (which
  // takes its records with it). Restricted to A/AAAA — this is for
  // name-to-address mappings, not general record editing.
  router.post("/create-zone", async (req, res) => {
    const { zone } = req.body ?? {};
    if (typeof zone !== "string" || !zone.trim()) {
      res.status(400).json({ error: "zone is required" });
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
      "/zones/create",
      { zone: zone.trim(), type: "Primary" },
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/add-record", async (req, res) => {
    const { domain, zone, type, ipAddress, ttl } = req.body ?? {};
    if (typeof domain !== "string" || !domain.trim()) {
      res.status(400).json({ error: "domain is required" });
      return;
    }
    if (type !== "A" && type !== "AAAA") {
      res.status(400).json({ error: "type must be A or AAAA" });
      return;
    }
    if (typeof ipAddress !== "string" || !ipAddress.trim()) {
      res.status(400).json({ error: "ipAddress is required" });
      return;
    }
    const config = requireConfig(db);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const params: Record<string, string> = { domain: domain.trim(), type, ipAddress: ipAddress.trim() };
    if (typeof zone === "string" && zone.trim()) params.zone = zone.trim();
    if (typeof ttl === "number" && ttl > 0) params.ttl = String(ttl);
    const result = await callTechnitiumAction(config.base_url, config.token, "/zones/records/add", params, fetchImpl);
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/delete-zone", async (req, res) => {
    const { zone } = req.body ?? {};
    if (typeof zone !== "string" || !zone.trim()) {
      res.status(400).json({ error: "zone is required" });
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
      "/zones/delete",
      { zone: zone.trim() },
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
