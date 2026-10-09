import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { loadAddonMode, applyAddonOptions, parsePeers, normalizePeer, cleanTechnitiumUrl } from "./addon.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolvr-addon-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeOptions(content: unknown): string {
  const file = path.join(dir, "options.json");
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

describe("loadAddonMode", () => {
  it("is not an add-on when there is no options file", () => {
    expect(loadAddonMode({ ADDON_OPTIONS_FILE: path.join(dir, "missing.json") })).toBeNull();
  });

  it("is an add-on when Home Assistant's options file exists, and reads the connection from it", () => {
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({ technitium_url: "http://dns.example.lan:5380", technitium_token: "abc" }) })!;
    expect(addon.managed).toBe(true);
    expect(addon.options.technitium_url).toBe("http://dns.example.lan:5380");
  });

  it("is not 'managed' until both the URL and the token are set", () => {
    expect(loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({ technitium_url: "http://x", technitium_token: "" }) })!.managed).toBe(false);
    expect(loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({}) })!.managed).toBe(false);
  });

  it("can be forced on without an options file", () => {
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: path.join(dir, "missing.json"), RESOLVR_ADDON: "true" });
    expect(addon).not.toBeNull();
    expect(addon!.managed).toBe(false);
  });

  it("still starts as an add-on when the options file cannot be parsed, rather than silently acting standalone", () => {
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions("{not json") });
    expect(addon).not.toBeNull();
    expect(addon!.managed).toBe(false);
  });
});

describe("trusted peers", () => {
  it("defaults to the Supervisor's ingress address", () => {
    expect([...parsePeers(undefined)]).toEqual(["172.30.32.2"]);
    expect([...parsePeers("  ")]).toEqual(["172.30.32.2"]);
  });

  it("takes a comma-separated override, treating IPv4-mapped addresses as the plain address", () => {
    expect([...parsePeers("10.0.0.5, ::ffff:10.0.0.6")]).toEqual(["10.0.0.5", "10.0.0.6"]);
    expect(normalizePeer("::ffff:172.30.32.2")).toBe("172.30.32.2");
    expect(normalizePeer(undefined)).toBe("");
  });
});

describe("applyAddonOptions", () => {
  it("writes the add-on's URL and token into the connection config", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null });
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({ technitium_url: " http://dns.example.lan:5380/ ", technitium_token: " tok " }) })!;
    expect(applyAddonOptions(db, addon)).toEqual({ ok: true });
    expect(db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get()).toEqual({ base_url: "http://dns.example.lan:5380", token: "tok" });
  });

  it("replaces an older value on the next start, so the options stay the source of truth", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null });
    db.prepare("UPDATE app_config SET base_url = 'http://old', token = 'old' WHERE id = 1").run();
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({ technitium_url: "https://new.example.lan", technitium_token: "new" }) })!;
    applyAddonOptions(db, addon);
    expect(db.prepare("SELECT base_url FROM app_config WHERE id = 1").get()).toEqual({ base_url: "https://new.example.lan" });
  });

  it("leaves the stored connection alone when the options are empty", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null });
    db.prepare("UPDATE app_config SET base_url = 'http://kept', token = 'kept' WHERE id = 1").run();
    expect(applyAddonOptions(db, loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({}) })!)).toEqual({ ok: true });
    expect(db.prepare("SELECT token FROM app_config WHERE id = 1").get()).toEqual({ token: "kept" });
  });

  it("refuses a URL that is not a web address, and says why", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null });
    const addon = loadAddonMode({ ADDON_OPTIONS_FILE: writeOptions({ technitium_url: "dns.example.lan", technitium_token: "t" }) })!;
    const res = applyAddonOptions(db, addon);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("http://");
    expect(db.prepare("SELECT base_url FROM app_config WHERE id = 1").get()).toEqual({ base_url: "" });
  });

  it("cleans a URL, and rejects other schemes", () => {
    expect(cleanTechnitiumUrl("http://a.example.lan:5380///")).toBe("http://a.example.lan:5380");
    expect(cleanTechnitiumUrl("ftp://a.example.lan")).toBeNull();
    expect(cleanTechnitiumUrl("nope")).toBeNull();
  });
});
