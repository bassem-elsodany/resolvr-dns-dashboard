// Resolution order:
// 1. A build-time VITE_BACKEND_URL, for anyone building from source
//    with a fixed target (e.g. backend on a different host/port).
// 2. Whatever host served this page, on port 8787 — correct for the
//    common case (frontend and backend containers on the same
//    machine, default ports) with zero configuration, including when
//    the browser reaches the UI via a LAN IP or hostname rather than
//    "localhost" (confirmed live: a Raspberry Pi deploy reached from
//    another device failed outright because the old hardcoded default
//    was "http://localhost:8787", which — from that OTHER device's
//    browser — means its own loopback, not the Pi).
export function resolveBackendUrl(): string {
  const buildTime = import.meta.env.VITE_BACKEND_URL
  if (buildTime) return buildTime.replace(/\/+$/, "")

  if (typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8787`
  }
  return "http://localhost:8787"
}
