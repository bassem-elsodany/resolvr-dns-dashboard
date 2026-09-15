import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { actionRoutes } from "./actionRoutes.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function testApp(fetchImpl: typeof fetch, configured = true) {
  const db = openDb({ path: ":memory:" });
  if (configured) {
    db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run(
      "http://10.0.60.60:5380",
      "secret-token",
    );
  }
  const app = express();
  app.use(express.json());
  app.use("/api/actions", actionRoutes(db, { fetchImpl }));
  return { app, db };
}

describe("actionRoutes", () => {
  it("flushes the DNS cache by calling the exact Technitium endpoint, with the stored token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://10.0.60.60:5380/api/cache/flush");
    expect(calledInit?.method).toBe("POST");
    expect(new Headers(calledInit?.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("forces a block-list update by calling the exact Technitium endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/update-block-lists");

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://10.0.60.60:5380/api/settings/forceUpdateBlockLists");
  });

  it("updates the block list URLs, comma-joined in order, comments and URLs alike", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app)
      .put("/api/actions/block-list-urls")
      .send({ urls: ["# Hagezi PRO++", "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.plus.txt"] });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/settings/set");
    expect(url.searchParams.get("blockListUrls")).toBe(
      "# Hagezi PRO++,https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.plus.txt",
    );
  });

  it("sends 'false' to clear the block list URLs when saved as an empty list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).put("/api/actions/block-list-urls").send({ urls: [] });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    expect(new URL(String(calledUrl)).searchParams.get("blockListUrls")).toBe("false");
  });

  it("rejects a non-array urls body, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).put("/api/actions/block-list-urls").send({ urls: "not-an-array" });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds a domain to the Blocked Zones list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/block-domain").send({ domain: "example.com" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/blocked/add");
    expect(url.searchParams.get("domain")).toBe("example.com");
  });

  it("rejects block-domain without a domain, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/block-domain").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("removes a domain from the Blocked Zones list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/unblock-domain").send({ domain: "example.com" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/blocked/delete");
    expect(url.searchParams.get("domain")).toBe("example.com");
  });

  it("rejects unblock-domain without a domain, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/unblock-domain").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revokes a session by partialToken", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok", response: {} }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/revoke-session").send({ partialToken: "ddfaecb8e9325e77" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/admin/sessions/delete");
    expect(url.searchParams.get("partialToken")).toBe("ddfaecb8e9325e77");
  });

  it("rejects revoke-session without a partialToken, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/revoke-session").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 400 for any action when no server is configured yet, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl, false);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 502 with Technitium's error message when the action fails upstream", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "error", errorMessage: "Permission denied." }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Permission denied.");
  });
});
