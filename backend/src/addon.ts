import fs from "node:fs";
import type { Database } from "better-sqlite3";

// Home Assistant add-on support. When Resolvr runs as an add-on the
// Supervisor mounts the user's settings at /data/options.json and puts
// every request behind its own authenticated "ingress" proxy. That changes
// three things, all handled here and in the middleware that uses this:
//   - nobody logs in to Resolvr itself: Home Assistant already did, so
//     requests that really come from the ingress proxy are trusted;
//   - the Technitium URL and API token come from the add-on's
//     Configuration tab, not from the Connection Settings page;
//   - the database lives in /data, which Home Assistant keeps and backs up.

export interface AddonOptions {
  technitium_url?: string;
  technitium_token?: string;
}

export interface AddonMode {
  options: AddonOptions;
  // Addresses a request must come from to be trusted as the ingress proxy.
  trustedPeers: ReadonlySet<string>;
  // True when the Technitium connection is set by the add-on options.
  managed: boolean;
}

const DEFAULT_OPTIONS_FILE = "/data/options.json";
// The Supervisor's ingress proxy always connects from this address.
const DEFAULT_INGRESS_PEER = "172.30.32.2";

// "::ffff:172.30.32.2" is the same peer as "172.30.32.2".
export function normalizePeer(address: string | undefined): string {
  return (address ?? "").replace(/^::ffff:/i, "");
}

export function parsePeers(value: string | undefined): Set<string> {
  const list = (value ?? "").split(",").map((s) => normalizePeer(s.trim())).filter(Boolean);
  return new Set(list.length ? list : [DEFAULT_INGRESS_PEER]);
}

function readOptionsFile(file: string): AddonOptions | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as AddonOptions) : {};
  } catch (err) {
    // A missing file just means this is not an add-on. A file that exists
    // but cannot be read is a real problem worth saying out loud.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`Could not read add-on options from ${file}: ${(err as Error).message}`);
    return {};
  }
}

// Returns null when not running as an add-on. RESOLVR_ADDON=true forces
// add-on mode (used in tests and for trying it outside Home Assistant).
export function loadAddonMode(env: NodeJS.ProcessEnv = process.env): AddonMode | null {
  const file = env.ADDON_OPTIONS_FILE ?? DEFAULT_OPTIONS_FILE;
  const options = readOptionsFile(file);
  if (options === null && env.RESOLVR_ADDON !== "true") return null;
  const opts = options ?? {};
  const url = (opts.technitium_url ?? "").trim();
  const token = (opts.technitium_token ?? "").trim();
  return { options: opts, trustedPeers: parsePeers(env.TRUSTED_INGRESS_IPS), managed: Boolean(url && token) };
}

export function cleanTechnitiumUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

// Writes the add-on's URL and token into the connection config on every
// start, so the options are always the source of truth when they are set.
export function applyAddonOptions(db: Database, addon: AddonMode): { ok: boolean; error?: string } {
  if (!addon.managed) return { ok: true };
  const url = cleanTechnitiumUrl(addon.options.technitium_url ?? "");
  if (!url) return { ok: false, error: "technitium_url must be a web address starting with http:// or https://" };
  db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run(url, (addon.options.technitium_token ?? "").trim());
  return { ok: true };
}
