import { defineStore } from "pinia"
import { ref } from "vue"
import { listApps, type TechnitiumCredentials, type QueryLogsApp } from "../api/technitium"

// Finds and caches which installed app actually provides query logging
// (flagged isQueryLogger: true in its dnsApps array) — Technitium ships
// four official variants (Sqlite/MySQL/PostgreSQL/SQL Server) with
// different classPaths, plus third-party loggers are possible, so this
// can't be hardcoded. Shared by ClientsView and QueryLogsView, which
// both call queryLogs()/exportLogs() and need the same app info.
export const useQueryLogsAppStore = defineStore("queryLogsApp", () => {
  const app = ref<QueryLogsApp | null>(null)
  const name = ref<string | null>(null)
  const checked = ref(false)
  const missing = ref(false)

  async function ensure(credentials: TechnitiumCredentials): Promise<void> {
    if (checked.value) return
    try {
      const res = await listApps(credentials)
      const match = res.response.apps.find((a) => a.dnsApps?.some((d) => d.isQueryLogger))
      const logger = match?.dnsApps?.find((d) => d.isQueryLogger)
      if (match && logger) {
        app.value = { name: match.name, classPath: logger.classPath }
        name.value = match.name
        missing.value = false
      } else {
        app.value = null
        name.value = null
        missing.value = true
      }
    } catch {
      // If the check itself fails, don't block on it — the subsequent
      // queryLogs()/exportLogs() call (if attempted) will surface its
      // own error instead.
      missing.value = false
    } finally {
      checked.value = true
    }
  }

  return { app, name, checked, missing, ensure }
})
