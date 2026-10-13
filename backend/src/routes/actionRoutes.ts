import { Router, type Request } from "express";
import type { Database } from "better-sqlite3";
import { callTechnitiumAction } from "../technitiumAction.js";
import { logger, clean } from "../logger.js";
import type { AppConfigRow } from "../db.js";
import { serverForRequest } from "../servers.js";

// A cluster node's domain name: letters, digits, dots and hyphens only, so a
// caller can never inject another parameter or path through it.
const NODE_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

// The optional `node` of a request body: undefined when absent (the
// connected node answers), the name when valid, null when it is not a plain
// host name. Used by every action that can be aimed at one cluster node.
function readNode(body: unknown): string | undefined | null {
  const node = (body as { node?: unknown } | undefined)?.node;
  if (node === undefined) return undefined;
  return typeof node === "string" && NODE_NAME.test(node) ? node : null;
}

export interface ActionRoutesOptions {
  fetchImpl?: typeof fetch;
}

// The server this request is about (see SERVER_HEADER), or null when it is
// unknown or has no URL and token yet.
function requireConfig(db: Database, req: Request): AppConfigRow | null {
  const config = serverForRequest(db, req);
  return config && config.base_url && config.token ? config : null;
}

// Admin-only mutating actions — the one deliberate exception to this
// dashboard's read-only design. Each route hardcodes exactly one
// Technitium API call (see APIDOCS.md: Flush DNS Cache, Force Update
// Block Lists, Delete Session); none of them accept a caller-supplied
// path, so they can't be turned into a general write proxy.
export function actionRoutes(db: Database, options: ActionRoutesOptions = {}): Router {
  const fetchImpl = options.fetchImpl ?? fetch;
  const router = Router();

  // One audit line per admin action: who ran it, what, on which node, and how
  // it ended. Request bodies (domains, URLs, tokens) are never logged.
  router.use((req, res, next) => {
    res.on("finish", () => {
      const who = clean((req as { user?: { username?: string } }).user?.username ?? "unknown");
      const node = typeof req.body?.node === "string" && req.body.node ? ` on node ${clean(req.body.node)}` : "";
      const line = `Admin action ${req.path}${node} by ${who}: ${res.statusCode}`;
      if (res.statusCode >= 400) logger.warn(line);
      else logger.info(line);
    });
    next();
  });

  // On a Technitium cluster each node keeps its own cache. `node` aims the
  // flush at one of them; left out, the connected node is flushed.
  router.post("/flush-cache", async (req, res) => {
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/cache/flush",
      node ? { node } : {},
      fetchImpl,
    );
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/update-block-lists", async (req, res) => {
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/settings/forceUpdateBlockLists",
      node ? { node } : {},
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
    // The list is sent as one comma-separated string, so a comma inside an
    // entry (or a line break) would silently split it into two entries.
    if (urls.some((u) => /[,\r\n]/.test(u))) {
      res.status(400).json({ error: "Feed entries cannot contain commas or line breaks." });
      return;
    }
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const value = urls.length === 0 ? "false" : urls.join(",");
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/settings/set",
      { blockListUrls: value, ...(node ? { node } : {}) },
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
    const config = requireConfig(db, req);
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
    const config = requireConfig(db, req);
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
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/apps/uninstall",
      { name: name.trim(), ...(node ? { node } : {}) },
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
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/zones/create",
      { zone: zone.trim(), type: "Primary", ...(node ? { node } : {}) },
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
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const params: Record<string, string> = { domain: domain.trim(), type, ipAddress: ipAddress.trim() };
    if (node) params.node = node;
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
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/zones/delete",
      { zone: zone.trim(), ...(node ? { node } : {}) },
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
    const node = readNode(req.body);
    if (node === null) {
      res.status(400).json({ error: "node must be a plain host name" });
      return;
    }
    const config = requireConfig(db, req);
    if (!config) {
      res.status(400).json({ error: "No Technitium server is configured yet." });
      return;
    }
    const result = await callTechnitiumAction(
      config.base_url,
      config.token,
      "/admin/sessions/delete",
      { partialToken, ...(node ? { node } : {}) },
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
