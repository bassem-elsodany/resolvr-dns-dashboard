import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });
}

const ADMIN = { username: "admin", password: "correct-horse-battery" };

// Builds an app with an in-memory DB, a seeded admin, and a Technitium
// config already saved — then logs in and returns a supertest agent
// that carries the session cookie across requests, matching how the
// browser actually talks to this backend.
async function setupAuthed(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const db = openDb({ path: ":memory:", seedAdmin: ADMIN });
  db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run(
    "http://10.0.60.60:5380",
    "secret-token",
  );
  const app: Express = createApp({ db, fetchImpl });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send(ADMIN);
  return { app, agent, db };
}

describe("proxy authentication", () => {
  it("rejects a proxy request with no session cookie", async () => {
    const db = openDb({ path: ":memory:", seedAdmin: ADMIN });
    const app = createApp({ db, fetchImpl: vi.fn() });

    const res = await request(app).get("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(401);
  });

  it("rejects a proxy request once no Technitium server has been configured yet", async () => {
    const db = openDb({ path: ":memory:", seedAdmin: ADMIN }); // config left empty
    const app = createApp({ db, fetchImpl: vi.fn() });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send(ADMIN);

    const res = await agent.get("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(400);
  });
});

describe("proxy allowlist enforcement", () => {
  it("rejects a path that is not on the allowlist, without calling upstream", async () => {
    const fetchImpl = vi.fn();
    const { agent } = await setupAuthed(fetchImpl);

    const res = await agent.get("/api/technitium/zones/delete");

    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-GET request to an otherwise-allowed path, without calling upstream", async () => {
    const fetchImpl = vi.fn();
    const { agent } = await setupAuthed(fetchImpl);

    const res = await agent.post("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("proxy forwarding", () => {
  let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ response: { stats: { totalQueries: 5133 } }, status: "ok" }),
    );
  });

  it("forwards an allowed path to the admin-configured Technitium server with the bearer token", async () => {
    const { agent } = await setupAuthed(fetchImpl);

    await agent.get("/api/technitium/dashboard/stats/get").query({ type: "LastHour" });

    // First call is the login-time /user/session/get validation ping,
    // fired by PUT /api/config — but setupAuthed writes config directly
    // to the DB and skips that endpoint, so the only call here is the
    // proxied request itself.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(calledInit?.headers);
    expect(String(calledUrl)).toBe("http://10.0.60.60:5380/api/dashboard/stats/get?type=LastHour");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("returns the upstream JSON body and status unchanged", async () => {
    const { agent } = await setupAuthed(fetchImpl);

    const res = await agent.get("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ response: { stats: { totalQueries: 5133 } }, status: "ok" });
  });

  it("returns 502 when the upstream server is unreachable", async () => {
    const { agent } = await setupAuthed(vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const res = await agent.get("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(502);
  });

  it("a viewer can use the proxy, but not the admin-only config or users routes", async () => {
    const { app, agent: adminAgent } = await setupAuthed(fetchImpl);
    await adminAgent
      .post("/api/users")
      .send({ username: "viewer1", password: "viewer-password-123", role: "viewer" });

    const viewerAgent = request.agent(app);
    await viewerAgent.post("/api/auth/login").send({ username: "viewer1", password: "viewer-password-123" });

    const proxyRes = await viewerAgent.get("/api/technitium/dashboard/stats/get");
    const configRes = await viewerAgent.get("/api/config");
    const usersRes = await viewerAgent.get("/api/users");

    expect(proxyRes.status).toBe(200);
    expect(configRes.status).toBe(403);
    expect(usersRes.status).toBe(403);
  });
});

describe("CORS", () => {
  it("allows the configured frontend origin", async () => {
    const app = createApp({ frontendOrigin: "http://localhost:5173", fetchImpl: vi.fn(), db: openDb({ path: ":memory:" }) });

    const res = await request(app).get("/healthz").set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
