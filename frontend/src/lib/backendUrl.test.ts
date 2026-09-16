import { describe, it, expect, vi, afterEach } from "vitest"

describe("resolveBackendUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
})
