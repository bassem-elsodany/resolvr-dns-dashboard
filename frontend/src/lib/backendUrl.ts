declare global {
  interface Window {
    __RESOLVR_ENV__?: { BACKEND_URL?: string }
  }
}

// Resolution order:
// 1. A runtime BACKEND_URL, injected into env-config.js by
//    docker/docker-entrypoint.sh from the container's environment — set
//    this (no rebuild needed) when the frontend sits behind a reverse
//    proxy that forwards /api to the backend on an address other than
//    "this page's own host, port 8787" (e.g. the proxy forwards to the
//    backend on the same public origin, no port — confirmed live:
//    https://github.com/bassem-elsodany/resolvr-dns-dashboard/issues/2).
// 2. A build-time VITE_BACKEND_URL, for anyone building from source
//    with a fixed target (e.g. backend on a different host/port).
// 3. Whatever host served this page, on port 8787 — correct for the
//    common case (frontend and backend containers on the same
//    machine, default ports) with zero configuration, including when
//    the browser reaches the UI via a LAN IP or hostname rather than
//    "localhost" (confirmed live: a Raspberry Pi deploy reached from
//    another device failed outright because the old hardcoded default
//    was "http://localhost:8787", which — from that OTHER device's
//    browser — means its own loopback, not the Pi).
export function resolveBackendUrl(): string {
  if (typeof window !== "undefined") {
    const runtime = window.__RESOLVR_ENV__?.BACKEND_URL
    if (runtime) return runtime.replace(/\/+$/, "")
  }

  const buildTime = import.meta.env.VITE_BACKEND_URL
  if (buildTime) return buildTime.replace(/\/+$/, "")

  if (typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8787`
  }
  return "http://localhost:8787"
}
