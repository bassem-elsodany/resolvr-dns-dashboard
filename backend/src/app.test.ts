import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });
}

describe("proxy header validation", () => {
  it("rejects a request missing both Technitium headers", async () => {
    const app = createApp({ fetchImpl: vi.fn() });

    const res = await request(app).get("/api/technitium/dashboard/stats/get");

    expect(res.status).toBe(400);
  });

  it("rejects a request missing only the token header", async () => {
    const app = createApp({ fetchImpl: vi.fn() });

    const res = await request(app)
      .get("/api/technitium/dashboard/stats/get")
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380");

    expect(res.status).toBe(400);
  });
});

describe("proxy allowlist enforcement", () => {
  it("rejects a path that is not on the allowlist, without calling upstream", async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ fetchImpl });

    const res = await request(app)
      .get("/api/technitium/zones/delete")
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380")
      .set("X-Technitium-Token", "abc123");

    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-GET request to an otherwise-allowed path, without calling upstream", async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ fetchImpl });

    const res = await request(app)
      .post("/api/technitium/dashboard/stats/get")
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380")
      .set("X-Technitium-Token", "abc123");

    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("proxy forwarding", () => {
  let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ response: { stats: { totalQueries: 5133 } }, status: "ok" })
    );
  });

  it("forwards an allowed path to the configured Technitium server with the bearer token", async () => {
    const app = createApp({ fetchImpl });

    await request(app)
      .get("/api/technitium/dashboard/stats/get")
      .query({ type: "LastHour" })
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380")
      .set("X-Technitium-Token", "secret-token");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(calledInit?.headers);
    expect(String(calledUrl)).toBe("http://10.0.60.60:5380/api/dashboard/stats/get?type=LastHour");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("returns the upstream JSON body and status unchanged", async () => {
    const app = createApp({ fetchImpl });

    const res = await request(app)
      .get("/api/technitium/dashboard/stats/get")
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380")
      .set("X-Technitium-Token", "secret-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ response: { stats: { totalQueries: 5133 } }, status: "ok" });
  });

  it("returns 502 when the upstream server is unreachable", async () => {
    const app = createApp({
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED")),
    });

    const res = await request(app)
      .get("/api/technitium/dashboard/stats/get")
      .set("X-Technitium-Base-Url", "http://10.0.60.60:5380")
      .set("X-Technitium-Token", "secret-token");

    expect(res.status).toBe(502);
  });
});

describe("CORS", () => {
  it("allows the configured frontend origin", async () => {
    const app = createApp({ frontendOrigin: "http://localhost:5173", fetchImpl: vi.fn() });

    const res = await request(app)
      .get("/healthz")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
