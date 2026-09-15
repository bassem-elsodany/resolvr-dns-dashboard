<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { listZones, getZoneRecords, TechnitiumApiError, type ZoneSummary, type ZoneRecord } from "../../api/technitium"
import { formatRecordValue } from "../../lib/formatRecordValue"

const connection = useConnectionStore()

const ZONES_PER_PAGE = 15

const filterName = ref("")
const pageNumber = ref(1)
const totalPages = ref(1)
const totalZones = ref(0)

const loading = ref(false)
const loadError = ref<string | null>(null)
const zones = ref<ZoneSummary[]>([])

const selectedZone = ref<string | null>(null)
const zoneRecords = ref<ZoneRecord[]>([])
const recordsLoading = ref(false)
const recordsError = ref<string | null>(null)

type Health = "ok" | "expired" | "syncFailed" | "notifyFailed"

function zoneHealth(zone: ZoneSummary): Health {
  if (zone.isExpired) return "expired"
  if (zone.syncFailed) return "syncFailed"
  if (zone.notifyFailed) return "notifyFailed"
  return "ok"
}

const healthLabel: Record<Health, string> = {
  ok: "Healthy",
  expired: "Expired",
  syncFailed: "Sync failed",
  notifyFailed: "Notify failed",
}

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listZones(connection.credentials, {
      pageNumber: pageNumber.value,
      zonesPerPage: ZONES_PER_PAGE,
      filterName: filterName.value || undefined,
    })
    zones.value = res.response.zones
    totalPages.value = res.response.totalPages
    totalZones.value = res.response.totalZones
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load zones."
  } finally {
    loading.value = false
  }
}

async function selectZone(name: string): Promise<void> {
  selectedZone.value = name
  recordsLoading.value = true
  recordsError.value = null
  try {
    const res = await getZoneRecords(name, connection.credentials)
    zoneRecords.value = res.response.records
  } catch (err) {
    recordsError.value = err instanceof TechnitiumApiError ? err.message : "Could not load zone records."
    zoneRecords.value = []
  } finally {
    recordsLoading.value = false
  }
}

function onFilterChange(): void {
  pageNumber.value = 1
  void load()
}

function goToPage(delta: number): void {
  const next = pageNumber.value + delta
  if (next < 1 || next > totalPages.value) return
  pageNumber.value = next
  void load()
}

onMounted(load)
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
        <h1 class="text-lg font-semibold tracking-tight text-fg">Authoritative Zones</h1>
        <p class="mt-1 text-sm text-gray-500">{{ totalZones }} zones hosted on this server</p>
      </div>
      <input
        id="zone-filter"
        v-model="filterName"
        placeholder="Filter by zone name…"
        class="w-56 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
        @change="onFilterChange"
      />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      zones.
    </p>
    <p v-else-if="loadError" id="zones-error" class="text-sm text-crit">{{ loadError }}</p>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
      <div>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-2.5 py-2 font-bold">Zone</th>
                <th class="px-2.5 py-2 font-bold">Type</th>
                <th class="px-2.5 py-2 font-bold">DNSSEC</th>
                <th class="px-2.5 py-2 font-bold">Health</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="zones.length === 0">
                <td colspan="4" class="px-3 py-6 text-center text-gray-500">
                  {{ loading ? "Loading…" : "No zones match." }}
                </td>
              </tr>
              <tr
                v-for="zone in zones"
                :key="zone.name"
                class="cursor-pointer border-b border-border last:border-b-0"
                :class="selectedZone === zone.name ? 'bg-accent/7' : ''"
                @click="selectZone(zone.name)"
              >
                <td class="px-2.5 py-1.5 font-mono">{{ zone.name || "(root)" }}</td>
                <td class="px-2.5 py-1.5 text-gray-500">{{ zone.type }}</td>
                <td class="px-2.5 py-1.5 text-gray-500">{{ zone.dnssecStatus }}</td>
                <td class="px-2.5 py-1.5">
                  <span
                    class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                    :class="{
                      ok: 'bg-ok/12 text-ok',
                      expired: 'bg-crit/12 text-crit',
                      syncFailed: 'bg-crit/12 text-crit',
                      notifyFailed: 'bg-warn/12 text-warn',
                    }[zoneHealth(zone)]"
                  >
                    {{ healthLabel[zoneHealth(zone)] }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="totalPages > 1" class="mt-2 flex items-center justify-between text-[11.5px] text-gray-500">
          <span>Page {{ pageNumber }} of {{ totalPages }}</span>
          <div class="flex gap-1">
            <button
              type="button"
              class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
              :disabled="pageNumber <= 1"
              @click="goToPage(-1)"
            >
              Prev
            </button>
            <button
              type="button"
              class="rounded-md border border-border px-2 py-1 disabled:opacity-40"
              :disabled="pageNumber >= totalPages"
              @click="goToPage(1)"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-border bg-background-card p-3.5">
        <div v-if="!selectedZone" class="py-10 text-center text-sm text-gray-500">
          Select any zone on the left to preview its records here &mdash; view only.
        </div>
        <template v-else>
          <div class="mb-2 font-mono text-[13px] font-semibold">{{ selectedZone }}</div>
          <p v-if="recordsError" id="zone-records-error" class="text-sm text-crit">{{ recordsError }}</p>
          <p v-else-if="recordsLoading" class="text-sm text-gray-500">Loading…</p>
          <div v-else class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-left text-[12px]">
              <thead>
                <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                  <th class="px-2.5 py-1.5 font-bold">Name</th>
                  <th class="px-2.5 py-1.5 font-bold">Type</th>
                  <th class="px-2.5 py-1.5 font-bold">TTL</th>
                  <th class="px-2.5 py-1.5 font-bold">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, i) in zoneRecords" :key="i" class="border-b border-border last:border-b-0">
                  <td class="px-2.5 py-1.5 font-mono">{{ record.name }}</td>
                  <td class="px-2.5 py-1.5 text-gray-500">{{ record.type }}</td>
                  <td class="px-2.5 py-1.5 tabular-nums">{{ record.ttl }}</td>
                  <td class="max-w-[260px] truncate px-2.5 py-1.5 font-mono text-gray-500">
                    {{ formatRecordValue(record.rData) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
