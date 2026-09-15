import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { configRoutes, statusRoute } from "./configRoutes.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function testApp(fetchImpl: typeof fetch) {
  const db = openDb({ path: ":memory:" });
  const app = express();
  app.use(express.json());
  app.get("/api/status", statusRoute(db, { fetchImpl }));
  app.use("/api/config", configRoutes(db, { fetchImpl }));
  return { app, db };
}

describe("configRoutes", () => {
  it("validates against the real Technitium server before persisting new connection details", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ status: "ok", info: { dnsServerDomain: "dns.villa58.lan", version: "15.4" } }),
      );
    const { app, db } = testApp(fetchImpl);

    const res = await request(app)
      .put("/api/config")
      .send({ baseUrl: "http://10.0.60.60:5380", token: "secret" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ serverDomain: "dns.villa58.lan", serverVersion: "15.4" });
    const stored = db.prepare("SELECT base_url, token FROM app_config WHERE id = 1").get();
    expect(stored).toEqual({ base_url: "http://10.0.60.60:5380", token: "secret" });
  });

  it("rejects and does not persist an invalid token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "invalid-token", errorMessage: "Invalid token or session expired." }));
    const { app, db } = testApp(fetchImpl);

    const res = await request(app).put("/api/config").send({ baseUrl: "http://10.0.60.60:5380", token: "bad" });

    expect(res.status).toBe(400);
    const stored = db.prepare("SELECT base_url FROM app_config WHERE id = 1").get() as { base_url: string };
    expect(stored.base_url).toBe("");
  });

  it("reports unconfigured status when nothing has been saved yet", async () => {
    const { app } = testApp(vi.fn());

    const res = await request(app).get("/api/status");

    expect(res.body).toEqual({ configured: false, connected: false, serverDomain: null, serverVersion: null });
  });

  it("reports connected status once a valid config is saved", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ status: "ok", info: { dnsServerDomain: "dns.villa58.lan", version: "15.4" } }),
      );
    const { app } = testApp(fetchImpl);
    await request(app).put("/api/config").send({ baseUrl: "http://10.0.60.60:5380", token: "secret" });

    const res = await request(app).get("/api/status");

    expect(res.body).toEqual({
      configured: true,
      connected: true,
      serverDomain: "dns.villa58.lan",
      serverVersion: "15.4",
      error: null,
    });
  });
});
