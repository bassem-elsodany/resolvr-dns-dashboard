import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { getStatus, setServerConfig, AppApiError } from "../api/app"
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
      isConfigured.value = true
      status.value = "connected"
      serverDomain.value = res.serverDomain
      serverVersion.value = res.serverVersion
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
  }

  return {
    baseUrl,
    token,
    status,
    error,
    serverDomain,
    serverVersion,
    isConfigured,
    credentials,
    setConfig,
    testConnection,
    reset,
  }
})
