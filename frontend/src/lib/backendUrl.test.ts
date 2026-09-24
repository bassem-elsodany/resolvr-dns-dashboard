import { describe, it, expect, vi, afterEach } from "vitest"

describe("resolveBackendUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete window.__RESOLVR_ENV__
    vi.resetModules()
  })

  it("falls back to the page's own host on port 8787 when no build-time URL is set", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "")
    vi.stubGlobal("location", { protocol: "http:", hostname: "192.168.1.50" } as Location)

    const { resolveBackendUrl } = await import("./backendUrl")

    // Regression: a Raspberry Pi deploy reached from another device's
    // browser got "Failed to fetch" because the old hardcoded default
    // was "http://localhost:8787" — from that device's browser,
    // "localhost" means itself, not the Pi.
    expect(resolveBackendUrl()).toBe("http://192.168.1.50:8787")
  })

  it("prefers an explicit build-time VITE_BACKEND_URL when set", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "https://dns-api.example.com/")
    vi.stubGlobal("location", { protocol: "http:", hostname: "192.168.1.50" } as Location)

    const { resolveBackendUrl } = await import("./backendUrl")

    expect(resolveBackendUrl()).toBe("https://dns-api.example.com")
  })

  it("matches the page's protocol (https stays https)", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "")
    vi.stubGlobal("location", { protocol: "https:", hostname: "resolvr.example.com" } as Location)

    const { resolveBackendUrl } = await import("./backendUrl")

    expect(resolveBackendUrl()).toBe("https://resolvr.example.com:8787")
  })

  it("prefers a runtime BACKEND_URL (from env-config.js) over everything else", async () => {
    // Regression: https://github.com/bassem-elsodany/resolvr-dns-dashboard/issues/2
    // — behind a reverse proxy, "this page's host, port 8787" is wrong;
    // the proxy forwards /api to the backend on a different address.
    vi.stubEnv("VITE_BACKEND_URL", "https://dns-api.example.com/")
    vi.stubGlobal("location", { protocol: "https:", hostname: "resolvr.example.com" } as Location)
    window.__RESOLVR_ENV__ = { BACKEND_URL: "https://resolvr.app.ampohl.de/" }

    const { resolveBackendUrl } = await import("./backendUrl")

    expect(resolveBackendUrl()).toBe("https://resolvr.app.ampohl.de")
  })

  it("ignores an empty runtime BACKEND_URL and falls through", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "")
    vi.stubGlobal("location", { protocol: "http:", hostname: "192.168.1.50" } as Location)
    window.__RESOLVR_ENV__ = { BACKEND_URL: "" }

    const { resolveBackendUrl } = await import("./backendUrl")

    expect(resolveBackendUrl()).toBe("http://192.168.1.50:8787")
  })
})
