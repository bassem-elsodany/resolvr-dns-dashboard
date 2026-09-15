import { defineStore } from "pinia"
import { ref } from "vue"
import { listZones, listBlockedZones, listApps, getTopStats, type TechnitiumCredentials } from "../api/technitium"

// Backs the small count badges next to sidebar nav items in the
// approved wireframe (Clients, Zones, Blocked Zones, Apps). Fetched
// once when the connection becomes live, from AppShell — same pattern
// as stores/serverUpdate.ts. Each count is independent: one endpoint
// failing (see the CacheBlocked lesson in QueryLogsView) must not blank
// out the others, so every fetch is caught on its own.
export const useSidebarCountsStore = defineStore("sidebarCounts", () => {
  const zonesTotal = ref<number | null>(null)
  const blockedZonesTotal = ref<number | null>(null)
  const appsTotal = ref<number | null>(null)
  const rateLimitedClients = ref<number>(0)

  async function load(credentials: TechnitiumCredentials): Promise<void> {
    const [zones, blocked, apps, rateLimited] = await Promise.allSettled([
      listZones(credentials, { pageNumber: 1, zonesPerPage: 1 }),
      listBlockedZones(credentials),
      listApps(credentials),
      getTopStats("TopClients", "LastDay", credentials, { onlyRateLimitedClients: true, limit: 1000 }),
    ])

    zonesTotal.value = zones.status === "fulfilled" ? zones.value.response.totalZones : null

    if (blocked.status === "fulfilled") {
      const { zones: zoneLabels, records } = blocked.value.response
      blockedZonesTotal.value =
        zoneLabels.length > 0 ? zoneLabels.length : new Set(records.map((r) => r.name)).size
    } else {
      blockedZonesTotal.value = null
    }

    appsTotal.value = apps.status === "fulfilled" ? apps.value.response.apps.length : null
    rateLimitedClients.value =
      rateLimited.status === "fulfilled" ? (rateLimited.value.response.topClients?.length ?? 0) : 0
  }

  return { zonesTotal, blockedZonesTotal, appsTotal, rateLimitedClients, load }
})
