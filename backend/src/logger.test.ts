import { describe, it, expect, vi } from "vitest";
import { createLogger, parseConfig } from "./logger.js";

function sink() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("parseConfig", () => {
  it("defaults to info, text, with request lines on", () => {
    expect(parseConfig({})).toEqual({ level: "info", format: "text", requests: true, problems: [] });
    expect(parseConfig({ LOG_LEVEL: "  ", LOG_FORMAT: "", LOG_REQUESTS: "" }).problems).toEqual([]);
  });

  it("accepts every level, format and boolean spelling, in any case", () => {
    expect(parseConfig({ LOG_LEVEL: "WARN" }).level).toBe("warn");
    expect(parseConfig({ LOG_LEVEL: " debug " }).level).toBe("debug");
    expect(parseConfig({ LOG_LEVEL: "silent" }).level).toBe("silent");
    expect(parseConfig({ LOG_FORMAT: "JSON" }).format).toBe("json");
    for (const v of ["false", "0", "No", "OFF"]) expect(parseConfig({ LOG_REQUESTS: v }).requests).toBe(false);
    for (const v of ["true", "1", "yes", "on"]) expect(parseConfig({ LOG_REQUESTS: v }).requests).toBe(true);
  });

  it("falls back to the default and reports each unknown value", () => {
    const c = parseConfig({ LOG_LEVEL: "verbose", LOG_FORMAT: "xml", LOG_REQUESTS: "maybe" });
    expect(c).toMatchObject({ level: "info", format: "text", requests: true });
    expect(c.problems).toHaveLength(3);
    expect(c.problems[0]).toContain("LOG_LEVEL");
  });
});

describe("createLogger", () => {
  it("info prints startup and request lines but not debug", () => {
    const s = sink();
    const l = createLogger({ level: "info" }, s);
    l.info("request");
    l.debug("healthz");
    l.warn("w");
    l.error("e");
    expect(s.log.mock.calls).toEqual([["request"]]);
    expect(s.warn).toHaveBeenCalledWith("w");
    expect(s.error).toHaveBeenCalledWith("e");
  });

  it("warn drops info and debug", () => {
    const s = sink();
    const l = createLogger({ level: "warn" }, s);
    l.info("request");
    l.debug("healthz");
    l.warn("w");
    expect(s.log).not.toHaveBeenCalled();
    expect(s.warn).toHaveBeenCalledWith("w");
  });

  it("error keeps only errors, silent keeps nothing", () => {
    const a = sink();
    const e = createLogger({ level: "error" }, a);
    e.warn("w");
    e.error("boom");
    expect(a.warn).not.toHaveBeenCalled();
    expect(a.error).toHaveBeenCalledWith("boom");

    const b = sink();
    createLogger({ level: "silent" }, b).error("boom");
    expect(b.error).not.toHaveBeenCalled();
  });

  it("debug prints everything", () => {
    const s = sink();
    createLogger({ level: "debug" }, s).debug("healthz");
    expect(s.log).toHaveBeenCalledWith("healthz");
  });

  it("json writes one object per line with the fields and a timestamp", () => {
    const s = sink();
    const l = createLogger({ level: "info", format: "json" }, s, () => new Date("2026-10-12T12:00:00Z"));
    l.info("GET /api/x 200 4ms", { method: "GET", status: 200, ms: 4 });
    expect(JSON.parse(s.log.mock.calls[0]![0] as string)).toEqual({
      time: "2026-10-12T12:00:00.000Z",
      level: "info",
      msg: "GET /api/x 200 4ms",
      method: "GET",
      status: 200,
      ms: 4,
    });
  });

  it("text ignores the fields so plain lines stay as they were", () => {
    const s = sink();
    createLogger({ level: "info" }, s).info("GET / 200 1ms", { status: 200 });
    expect(s.log).toHaveBeenCalledWith("GET / 200 1ms");
  });
});

describe("configure", () => {
  it("changes the level, format and request setting of an existing logger", () => {
    const s = sink();
    const l = createLogger({ level: "info" }, s);
    l.configure({ level: "warn", format: "json", requests: false });
    expect(l.level).toBe("warn");
    expect(l.requests).toBe(false);
    l.info("hidden");
    l.warn("shown");
    expect(s.log).not.toHaveBeenCalled();
    expect(JSON.parse(s.warn.mock.calls[0]![0] as string)).toMatchObject({ level: "warn", msg: "shown" });
  });
});
