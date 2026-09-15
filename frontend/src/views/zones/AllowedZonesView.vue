<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { listAllowedZones, exportAllowedZones, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"

const connection = useConnectionStore()
const refresh = useRefreshStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const domains = ref<string[]>([])
const filterText = ref("")

const filteredDomains = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return domains.value
  return domains.value.filter((d) => d.toLowerCase().includes(needle))
})

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listAllowedZones(connection.credentials)
    // /api/allowed/list is a domain-tree browser, not a flat lister: with
    // only one entry under the root, the API auto-descends and returns it
    // via `records` instead of `zones` — confirmed against the live
    // server, which has exactly one allowed zone and returned it this way.
    if (res.response.zones.length > 0) {
      domains.value = res.response.zones
    } else {
      domains.value = [...new Set(res.response.records.map((r) => r.name))]
    }
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load allowed zones."
  } finally {
    loading.value = false
  }
}

async function onExport(): Promise<void> {
  try {
    triggerDownload(await exportAllowedZones(connection.credentials))
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not export allowed zones."
  }
}

onMounted(load)
watch(() => refresh.tick, load)
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) load()
  },
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Allowed Zones</h1>
        <p class="mt-1 text-sm text-gray-500">Domains explicitly exempted from blocking</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="allowed-filter"
          v-model="filterText"
          placeholder="Filter…"
          class="w-44 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
        />
        <button
          id="export-allowed"
          type="button"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500"
          @click="onExport"
        >
          Export
        </button>
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      allowed zones.
    </p>
    <p v-else-if="loadError" id="allowed-error" class="text-sm text-crit">{{ loadError }}</p>

    <div v-else class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-left text-[12.5px]">
        <thead>
          <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
            <th class="px-3 py-2 font-bold">Domain</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredDomains.length === 0">
            <td class="px-3 py-6 text-center text-gray-500">
              {{ loading ? "Loading…" : "No allowed zones." }}
            </td>
          </tr>
          <tr v-for="domain in filteredDomains" :key="domain" class="border-b border-border last:border-b-0">
            <td class="px-3 py-2 font-mono">{{ domain }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
