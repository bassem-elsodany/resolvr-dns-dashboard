import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { getStatus, setServerConfig, listServers, AppApiError, type ObservedServer } from "../api/app"
import { getActiveServerId, setActiveServerId } from "../lib/activeServer"
import type { TechnitiumCredentials } from "../api/technitium"

export type ConnectionStatus = "idle" | "testing" | "connected" | "error"

// The Technitium connection (server URL + token) is now admin-managed
// and stored in the backend's own SQLite database — shared by everyone
// who logs into this dashboard, not per-browser localStorage. This
// store's public shape (isConfigured/credentials/serverDomain/...) is
// kept exactly as before so every view that already reads it doesn't
// need to change; only what backs it changed.
export const useConnectionStore = defineStore("connection", () => {
  const baseUrl = ref("")
  const token = ref("")
  const status = ref<ConnectionStatus>("idle")
  const error = ref<string | null>(null)
  const serverDomain = ref<string | null>(null)
  const serverVersion = ref<string | null>(null)
  const isConfigured = ref(false)
  // Part of a Technitium cluster — the dashboard can then show cluster-wide stats.
  const clusterInitialized = ref(false)
  // Every server this dashboard can observe, and which one this browser is
  // looking at (0 is the primary connection).
  const servers = ref<ObservedServer[]>([])
  // The result of the last save of the primary connection form. Separate from
  // serverDomain/serverVersion above, which describe whichever server the
  // sidebar has selected and so may be a different one.
  const primaryResult = ref<{ serverDomain: string; serverVersion: string } | null>(null)
  const activeServerId = ref(getActiveServerId())

  // No longer actually sent anywhere (see api/technitium.ts) — kept so
  // the ~30 view files that pass `connection.credentials` into API
  // calls don't need to change just because auth moved to a session
  // cookie.
  const credentials = computed<TechnitiumCredentials>(() => ({ baseUrl: baseUrl.value, token: token.value }))

  async function testConnection(): Promise<void> {
    status.value = "testing"
    try {
      const s = await getStatus()
      isConfigured.value = s.configured
      serverDomain.value = s.serverDomain
      serverVersion.value = s.serverVersion
      clusterInitialized.value = s.clusterInitialized === true
      if (!s.configured) {
        status.value = "idle"
        error.value = null
      } else if (s.connected) {
        status.value = "connected"
        error.value = null
      } else {
        status.value = "error"
        error.value = s.error ?? "Could not connect to the configured Technitium server."
      }
    } catch (err) {
      status.value = "error"
      error.value = err instanceof AppApiError ? err.message : "Could not reach the backend."
    }
  }

  async function loadServers(): Promise<void> {
    try {
      servers.value = (await listServers()).servers
      // A server that was removed since this browser chose it: fall back to
      // the primary rather than showing errors for something that is gone.
      if (!servers.value.some((s) => s.id === activeServerId.value)) {
        activeServerId.value = 0
        setActiveServerId(0)
      }
    } catch {
      // Older backend without /api/servers, or not signed in yet: a single
      // server, which is what the dashboard did before.
      servers.value = []
    }
  }

  // Everything on screen (stats scope, charts, lists) belongs to one server,
  // so switching starts the app afresh on the chosen one.
  function selectServer(id: number): void {
    if (id === activeServerId.value) return
    setActiveServerId(id)
    activeServerId.value = id
    window.location.reload()
  }

  // Admin-only: validates the given server details against the real
  // Technitium server (backend does the actual check) and, only if
  // that succeeds, persists them for every user of this dashboard.
  async function setConfig(newBaseUrl: string, newToken: string): Promise<void> {
    status.value = "testing"
    error.value = null
    try {
      const res = await setServerConfig(newBaseUrl, newToken)
      baseUrl.value = newBaseUrl
      token.value = newToken
      // The form edits the primary connection; the status panel shows the
      // server being observed, which may be another one.
      primaryResult.value = { serverDomain: res.serverDomain, serverVersion: res.serverVersion }
      if (activeServerId.value === 0) {
        isConfigured.value = true
        status.value = "connected"
        serverDomain.value = res.serverDomain
        serverVersion.value = res.serverVersion
        clusterInitialized.value = res.clusterInitialized === true
      } else {
        status.value = "idle"
      }
    } catch (err) {
      status.value = "error"
      error.value = err instanceof AppApiError ? err.message : "Could not connect to the server."
    }
  }

  function reset(): void {
    baseUrl.value = ""
    token.value = ""
    status.value = "idle"
    error.value = null
    serverDomain.value = null
    serverVersion.value = null
    isConfigured.value = false
    clusterInitialized.value = false
  }

  return {
    baseUrl,
    token,
    status,
    error,
    serverDomain,
    serverVersion,
    isConfigured,
    clusterInitialized,
    credentials,
    servers,
    primaryResult,
    activeServerId,
    loadServers,
    selectServer,
    setConfig,
    testConnection,
    reset,
  }
})
