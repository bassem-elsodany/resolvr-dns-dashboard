import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { createLogger, type LogConfig } from "./logger.js";

const ADMIN = { username: "admin", password: "correct-horse-battery" };

function setup(config: Partial<LogConfig> = {}) {
  const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = createLogger({ level: "info", ...config }, sink, () => new Date("2026-10-12T12:00:00Z"));
  const db = openDb({ path: ":memory:", seedAdmin: ADMIN });
  const app = createApp({ db, logger });
  return { app, sink };
}

const lines = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

describe("request logging", () => {
  it("writes one line per request at info, in the existing format", async () => {
    const { app, sink } = setup();
    await request(app).get("/api/auth/me");
    expect(lines(sink.log)).toHaveLength(1);
    expect(lines(sink.log)[0]).toMatch(/^GET \/api\/auth\/me 401 \d+ms$/);
  });

  it("keeps the healthcheck out of the log below debug, and shows it at debug", async () => {
    const quiet = setup({ level: "info" });
    await request(quiet.app).get("/healthz");
    expect(quiet.sink.log).not.toHaveBeenCalled();

    const loud = setup({ level: "debug" });
    await request(loud.app).get("/healthz");
    expect(lines(loud.sink.log)[0]).toMatch(/^GET \/healthz 200 /);
  });

  it("writes no request lines when LOG_REQUESTS is off, whatever the level", async () => {
    const { app, sink } = setup({ level: "debug", requests: false });
    await request(app).get("/api/auth/me");
    expect(sink.log).not.toHaveBeenCalled();
  });

  it("writes nothing at warn except warnings", async () => {
    const { app, sink } = setup({ level: "warn" });
    await request(app).get("/api/auth/me");
    expect(sink.log).not.toHaveBeenCalled();
  });

  it("writes JSON with method, url, status and duration when asked", async () => {
    const { app, sink } = setup({ format: "json" });
    await request(app).get("/api/auth/me");
    const entry = JSON.parse(lines(sink.log)[0]!);
    expect(entry).toMatchObject({ time: "2026-10-12T12:00:00.000Z", level: "info", method: "GET", url: "/api/auth/me", status: 401 });
    expect(typeof entry.ms).toBe("number");
  });
});

describe("what is not logged", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a password or a session token for a sign-in", async () => {
    const { app, sink } = setup({ level: "debug" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(app).post("/api/auth/login").send({ username: ADMIN.username, password: "wrong-password-123" });
    const login = await request(app).post("/api/auth/login").send(ADMIN);
    const everything = [...lines(sink.log), ...lines(sink.warn), ...spy.mock.calls.map(String), ...info.mock.calls.map(String)].join("\n");
    expect(everything).not.toContain("wrong-password-123");
    expect(everything).not.toContain(ADMIN.password);
    const cookie = String(login.headers["set-cookie"] ?? "");
    const token = /=([^;]+)/.exec(cookie)?.[1];
    if (token) expect(everything).not.toContain(token);
  });
});
