import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import type { AddonMode } from "./addon.js";

// supertest connects from 127.0.0.1, so that is the "ingress proxy" here.
const addon = (over: Partial<AddonMode> = {}): AddonMode => ({
  options: {},
  trustedPeers: new Set(["127.0.0.1"]),
  managed: false,
  ...over,
});

const make = (a: AddonMode | null) => createApp({ db: openDb({ path: ":memory:", seedAdmin: null }), addon: a });

describe("add-on mode: sign-in through Home Assistant", () => {
  it("treats a request from the ingress proxy as an admin, named from the Home Assistant user", async () => {
    const res = await request(make(addon())).get("/api/auth/me").set("X-Remote-User-Display-Name", "Bassem").set("X-Remote-User-Name", "bassem");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 0, username: "Bassem", role: "admin", external: true });
  });

  it("falls back to the user name header, then to a generic name", async () => {
    const app = make(addon());
    expect((await request(app).get("/api/auth/me").set("X-Remote-User-Name", "bassem")).body.username).toBe("bassem");
    expect((await request(app).get("/api/auth/me")).body.username).toBe("Home Assistant");
  });

  it("limits a very long name", async () => {
    const res = await request(make(addon())).get("/api/auth/me").set("X-Remote-User-Name", "x".repeat(500));
    expect(res.body.username).toHaveLength(64);
  });

  it("does not trust a request from anywhere else, whatever headers it sends", async () => {
    const app = make(addon({ trustedPeers: new Set(["172.30.32.2"]) }));
    const res = await request(app).get("/api/auth/me").set("X-Remote-User-Name", "intruder").set("X-Ingress-Path", "/api/hassio_ingress/abc");
    expect(res.status).toBe(401);
  });

  it("is not enabled at all outside add-on mode", async () => {
    const res = await request(make(null)).get("/api/auth/me").set("X-Remote-User-Name", "intruder");
    expect(res.status).toBe(401);
  });

  it("lets the ingress user reach admin-only routes", async () => {
    const res = await request(make(addon())).get("/api/config");
    expect(res.status).toBe(200);
  });

  it("has no Resolvr accounts to manage", async () => {
    const res = await request(make(addon())).get("/api/users");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Home Assistant");
  });
});

describe("add-on mode: the Technitium connection", () => {
  it("hides the token and refuses changes while the add-on options set the connection", async () => {
    const db = openDb({ path: ":memory:", seedAdmin: null });
    db.prepare("UPDATE app_config SET base_url = 'http://dns.example.lan:5380', token = 'secret' WHERE id = 1").run();
    const app = createApp({ db, addon: addon({ managed: true }) });

    const get = await request(app).get("/api/config");
    expect(get.body).toEqual({ baseUrl: "http://dns.example.lan:5380", token: "", managed: true });
    expect(JSON.stringify(get.body)).not.toContain("secret");

    const put = await request(app).put("/api/config").send({ baseUrl: "http://other", token: "x" });
    expect(put.status).toBe(409);
    expect(put.body.error).toContain("Configuration tab");
    expect(db.prepare("SELECT base_url FROM app_config WHERE id = 1").get()).toEqual({ base_url: "http://dns.example.lan:5380" });
  });

  it("allows setting it from the page when the add-on options are empty", async () => {
    const res = await request(make(addon({ managed: false }))).get("/api/config");
    expect(res.body.managed).toBe(false);
  });

  it("is unchanged outside add-on mode", async () => {
    const db = openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "adminpass1" } });
    const app = createApp({ db });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "admin", password: "adminpass1" });
    expect((await agent.get("/api/config")).body.managed).toBe(false);
    expect((await agent.get("/api/users")).status).toBe(200);
  });
});

describe("serving the web app", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function site(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "resolvr-web-"));
    dirs.push(d);
    fs.mkdirSync(path.join(d, "assets"));
    fs.writeFileSync(path.join(d, "index.html"), '<!doctype html><html><head><base href="/"><title>Resolvr</title></head><body><div id="app"></div></body></html>');
    fs.writeFileSync(path.join(d, "assets", "index-abc123.js"), "console.log(1)");
    fs.writeFileSync(path.join(d, "favicon.svg"), "<svg/>");
    return d;
  }

  const app = (d: string) => createApp({ db: openDb({ path: ":memory:", seedAdmin: null }), staticDir: d });

  it("serves the page at the root and for any route inside the app, so a refresh on /clients works", async () => {
    const a = app(site());
    for (const p of ["/", "/clients", "/blocked"]) {
      const res = await request(a).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<base href="/">');
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("points the page at Home Assistant's ingress path when it is reached through it", async () => {
    const res = await request(app(site())).get("/").set("X-Ingress-Path", "/api/hassio_ingress/aB3-_x9");
    expect(res.text).toContain('<base href="/api/hassio_ingress/aB3-_x9/">');
  });

  it("ignores an ingress path that is not the Supervisor's format, because it ends up inside the page", async () => {
    for (const bad of ['/"><script>alert(1)</script>', "/somewhere/else", "//evil.example.com", "/api/hassio_ingress/a/b", "/api/hassio_ingress/"]) {
      const res = await request(app(site())).get("/").set("X-Ingress-Path", bad);
      expect(res.text).toContain('<base href="/">');
      expect(res.text).not.toContain("alert(1)");
    }
  });

  it("serves built files, caching the hashed ones for good", async () => {
    const a = app(site());
    const js = await request(a).get("/assets/index-abc123.js");
    expect(js.status).toBe(200);
    expect(js.headers["cache-control"]).toContain("immutable");
    expect((await request(a).get("/favicon.svg")).status).toBe(200);
  });

  it("tells the page its API is on the same origin", async () => {
    const res = await request(app(site())).get("/env-config.js");
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("SAME_ORIGIN: true");
  });

  it("keeps API and health paths real: an unknown API path is a JSON 404, not the web page", async () => {
    const a = app(site());
    const missing = await request(a).get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain("<!doctype html>");
    expect((await request(a).get("/healthz")).body).toEqual({ status: "ok" });
    expect((await request(a).post("/anything")).status).toBe(404);
  });

  it("still gates the Technitium proxy behind sign-in", async () => {
    expect((await request(app(site())).get("/api/technitium/dashboard/stats/get")).status).toBe(401);
  });
});
