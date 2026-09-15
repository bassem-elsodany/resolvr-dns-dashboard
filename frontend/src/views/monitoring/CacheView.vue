<script setup lang="ts">
import { ref } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { listCache, TechnitiumApiError, type ZoneRecord } from "../../api/technitium"
import { formatRecordValue } from "../../lib/formatRecordValue"

const connection = useConnectionStore()

const domainInput = ref("")
const searchedDomain = ref<string | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const records = ref<ZoneRecord[]>([])
const zones = ref<string[]>([])

async function browse(): Promise<void> {
  const domain = domainInput.value.trim()
  if (!domain || !connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listCache(domain, connection.credentials)
    records.value = res.response.records
    zones.value = res.response.zones
    searchedDomain.value = domain
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not browse the cache."
    records.value = []
    zones.value = []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Cache</h1>
      <p class="mt-1 text-sm text-gray-500">Browse records the resolver currently holds in memory</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to
      browse the cache.
    </p>

    <template v-else>
      <form class="mb-4 flex items-end gap-2" @submit.prevent="browse">
        <div class="flex-1">
          <label for="cache-domain" class="mb-1 block text-[11px] font-semibold text-gray-500">Domain</label>
          <input
            id="cache-domain"
            v-model="domainInput"
            placeholder="google.com"
            class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 font-mono text-sm"
          />
        </div>
        <button
          id="browse-cache"
          type="submit"
          :disabled="loading"
          class="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ loading ? "Browsing…" : "Browse" }}
        </button>
      </form>

      <p v-if="loadError" id="cache-error" class="mb-3 text-sm text-crit">{{ loadError }}</p>

      <template v-else-if="searchedDomain">
        <div v-if="records.length === 0 && zones.length === 0" id="cache-empty" class="text-sm text-gray-500">
          Nothing cached for <span class="font-mono">{{ searchedDomain }}</span
          >.
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-3 py-2 font-bold">Name</th>
                <th class="px-3 py-2 font-bold">Type</th>
                <th class="px-3 py-2 font-bold">TTL remaining</th>
                <th class="px-3 py-2 font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(record, i) in records" :key="i" class="border-b border-border last:border-b-0">
                <td class="px-3 py-2 font-mono">{{ record.name }}</td>
                <td class="px-3 py-2 text-gray-500">{{ record.type }}</td>
                <td class="px-3 py-2 tabular-nums">{{ record.ttl }}</td>
                <td class="max-w-[360px] truncate px-3 py-2 font-mono text-gray-500">
                  {{ formatRecordValue(record.rData) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
