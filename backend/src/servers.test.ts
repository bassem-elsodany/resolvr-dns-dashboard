import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ADMIN = { username: "admin", password: "correct-horse-battery" };
const OK_PING = { status: "ok", info: { dnsServerDomain: "dns.example.lan", version: "15.4" } };

async function setup(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const db = openDb({ path: ":memory:", seedAdmin: ADMIN });
  db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run("http://primary:5380", "primary-token");
  const app = createApp({ db, fetchImpl });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send(ADMIN);
  return { app, agent, db };
}

describe("multiple servers", () => {
  it("lists the primary connection first, then added servers, never exposing tokens", async () => {
    const { agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));
    await agent.post("/api/servers").send({ name: "Segment 129", baseUrl: "http://s129:5380/", token: "t129" });

    const res = await agent.get("/api/servers");

    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual([
      { id: 0, name: "", baseUrl: "http://primary:5380", primary: true, configured: true },
      { id: 1, name: "Segment 129", baseUrl: "http://s129:5380", primary: false, configured: true },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("t129");
    expect(JSON.stringify(res.body)).not.toContain("primary-token");
  });

  it("validates a server against Technitium before saving it", async () => {
    const { agent, db } = await setup(
      vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ status: "invalid-token", errorMessage: "Invalid token" })),
    );

    const res = await agent.post("/api/servers").send({ name: "Bad", baseUrl: "http://bad:5380", token: "nope" });

    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM servers").get()).toEqual({ n: 0 });
  });

  it("requires a name, URL and token", async () => {
    const { agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));

    expect((await agent.post("/api/servers").send({ baseUrl: "http://x:5380", token: "t" })).status).toBe(400);
    expect((await agent.post("/api/servers").send({ name: "x", token: "t" })).status).toBe(400);
  });

  it("sends a proxied request to the server named in the header, with that server's token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING));
    const { agent } = await setup(fetchImpl);
    await agent.post("/api/servers").send({ name: "Segment 129", baseUrl: "http://s129:5380", token: "t129" });
    fetchImpl.mockClear();

    await agent.get("/api/technitium/dashboard/stats/get").set("X-Resolvr-Server", "1");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://s129:5380/api/dashboard/stats/get");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t129");
  });

  it("uses the primary connection when no server is named", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING));
    const { agent } = await setup(fetchImpl);

    await agent.get("/api/technitium/dashboard/stats/get");

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://primary:5380/api/dashboard/stats/get");
  });

  it("answers 404 for a server that does not exist, instead of falling back to the primary", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING));
    const { agent } = await setup(fetchImpl);
    fetchImpl.mockClear();

    const proxied = await agent.get("/api/technitium/dashboard/stats/get").set("X-Resolvr-Server", "99");
    const garbage = await agent.get("/api/status").set("X-Resolvr-Server", "abc");
    const action = await agent.post("/api/actions/flush-cache").set("X-Resolvr-Server", "99");

    expect(proxied.status).toBe(404);
    expect(garbage.status).toBe(404);
    // An action must never land on the primary by accident.
    expect(action.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the status of the selected server", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING));
    const { agent } = await setup(fetchImpl);
    await agent.post("/api/servers").send({ name: "Segment 129", baseUrl: "http://s129:5380", token: "t129" });
    fetchImpl.mockClear();

    const res = await agent.get("/api/status").set("X-Resolvr-Server", "1");

    expect(res.body).toMatchObject({ configured: true, connected: true, serverDomain: "dns.example.lan" });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://s129:5380/api/user/session/get");
  });

  it("aims an admin action at the selected server", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ status: "ok" }));
    const { agent } = await setup(fetchImpl);
    await agent.post("/api/servers").send({ name: "Segment 129", baseUrl: "http://s129:5380", token: "t129" });
    fetchImpl.mockClear();

    const res = await agent.post("/api/actions/flush-cache").set("X-Resolvr-Server", "1");

    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://s129:5380/api/cache/flush");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t129");
  });

  it("lets an admin rename and remove a server, and a viewer only list them", async () => {
    const { app, agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));
    await agent.post("/api/servers").send({ name: "Old", baseUrl: "http://s:5380", token: "t" });

    const renamed = await agent.put("/api/servers/1").send({ name: "New", baseUrl: "http://s:5380", token: "t" });
    expect(renamed.body).toMatchObject({ id: 1, name: "New" });

    await agent.post("/api/users").send({ username: "viewer1", password: "viewer-password-123", role: "viewer" });
    const viewer = request.agent(app);
    await viewer.post("/api/auth/login").send({ username: "viewer1", password: "viewer-password-123" });
    expect((await viewer.get("/api/servers")).status).toBe(200);
    expect((await viewer.post("/api/servers").send({ name: "x", baseUrl: "http://x:5380", token: "t" })).status).toBe(403);
    expect((await viewer.delete("/api/servers/1")).status).toBe(403);

    expect((await agent.delete("/api/servers/1")).status).toBe(200);
    expect((await agent.delete("/api/servers/1")).status).toBe(404);
    expect((await agent.get("/api/servers")).body.servers).toHaveLength(1);
  });

  it("does not let the primary be removed or edited through the servers routes", async () => {
    const { agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));

    expect((await agent.delete("/api/servers/0")).status).toBe(404);
    expect((await agent.put("/api/servers/0").send({ name: "x", baseUrl: "http://x:5380", token: "t" })).status).toBe(404);
  });

  it("renames a server without needing its token again, and without contacting it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING));
    const { agent } = await setup(fetchImpl);
    await agent.post("/api/servers").send({ name: "Old", baseUrl: "http://s:5380", token: "tok" });
    fetchImpl.mockClear();

    const res = await agent.put("/api/servers/1").send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: "Renamed", baseUrl: "http://s:5380" });
    expect(fetchImpl).not.toHaveBeenCalled();
    // The token was kept: the proxy still uses it.
    await agent.get("/api/technitium/dashboard/stats/get").set("X-Resolvr-Server", "1");
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("refuses a new URL without a token (or the reverse)", async () => {
    const { agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));
    await agent.post("/api/servers").send({ name: "S", baseUrl: "http://s:5380", token: "tok" });

    expect((await agent.put("/api/servers/1").send({ name: "S", baseUrl: "http://other:5380" })).status).toBe(400);
    expect((await agent.put("/api/servers/1").send({ name: "S", token: "x" })).status).toBe(400);
  });

  it("tests a URL and token without saving them", async () => {
    const { agent, db } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));

    const res = await agent.post("/api/servers/test").send({ baseUrl: "http://new:5380", token: "t" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", serverDomain: "dns.example.lan", serverVersion: "15.4" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM servers").get()).toEqual({ n: 0 });
  });

  it("reports why a test failed", async () => {
    const { agent } = await setup(
      vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ status: "invalid-token", errorMessage: "Invalid token" })),
    );

    const res = await agent.post("/api/servers/test").send({ baseUrl: "http://new:5380", token: "bad" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid token");
  });

  it("only lets an admin test", async () => {
    const { app, agent } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(OK_PING)));
    await agent.post("/api/users").send({ username: "viewer1", password: "viewer-password-123", role: "viewer" });
    const viewer = request.agent(app);
    await viewer.post("/api/auth/login").send({ username: "viewer1", password: "viewer-password-123" });

    expect((await viewer.post("/api/servers/test").send({ baseUrl: "http://x:5380", token: "t" })).status).toBe(403);
  });
});
