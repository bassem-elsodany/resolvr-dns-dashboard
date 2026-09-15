import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { getUserSession, TechnitiumApiError, type TechnitiumCredentials } from "../api/technitium"

const STORAGE_KEY = "resolvr.connection"

interface StoredConfig {
  baseUrl: string
  token: string
}

function loadStoredConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { baseUrl: "", token: "" }
    const parsed = JSON.parse(raw)
    if (typeof parsed.baseUrl === "string" && typeof parsed.token === "string") return parsed
  } catch {
    // Corrupt or inaccessible localStorage — fall through to empty config.
  }
  return { baseUrl: "", token: "" }
}

export type ConnectionStatus = "idle" | "testing" | "connected" | "error"

export const useConnectionStore = defineStore("connection", () => {
  const stored = loadStoredConfig()
  const baseUrl = ref(stored.baseUrl)
  const token = ref(stored.token)
  const status = ref<ConnectionStatus>("idle")
  const error = ref<string | null>(null)
  const serverDomain = ref<string | null>(null)
  const serverVersion = ref<string | null>(null)

  const isConfigured = computed(() => baseUrl.value.length > 0 && token.value.length > 0)
  const credentials = computed<TechnitiumCredentials>(() => ({
    baseUrl: baseUrl.value,
    token: token.value,
  }))

  function setConfig(newBaseUrl: string, newToken: string): void {
    baseUrl.value = newBaseUrl.trim().replace(/\/+$/, "")
    token.value = newToken.trim()
    status.value = "idle"
    error.value = null
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: baseUrl.value, token: token.value }))
  }

  async function testConnection(): Promise<void> {
    if (!isConfigured.value) {
      status.value = "error"
      error.value = "Enter both a server URL and an API token."
      return
    }

    status.value = "testing"
    error.value = null

    try {
      const session = await getUserSession(credentials.value)
      status.value = "connected"
      serverDomain.value = session.info.dnsServerDomain
      serverVersion.value = session.info.version
    } catch (err) {
      status.value = "error"
      serverDomain.value = null
      serverVersion.value = null
      error.value = err instanceof TechnitiumApiError ? err.message : "Could not connect to the server."
    }
  }

  function disconnect(): void {
    baseUrl.value = ""
    token.value = ""
    status.value = "idle"
    error.value = null
    serverDomain.value = null
    serverVersion.value = null
    localStorage.removeItem(STORAGE_KEY)
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
    disconnect,
  }
})
