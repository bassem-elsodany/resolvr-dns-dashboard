<script setup lang="ts">
import { ref, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { listCache, TechnitiumApiError, type ZoneRecord } from "../../api/technitium"
import { flushCache, AppApiError } from "../../api/app"
import { formatRecordValue } from "../../lib/formatRecordValue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()

const domainInput = ref("")
const searchedDomain = ref<string | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const records = ref<ZoneRecord[]>([])
const zones = ref<string[]>([])

const flushing = ref(false)
const flushError = ref<string | null>(null)
const flushedJustNow = ref(false)
const confirmingFlush = ref(false)

function startFlushConfirm(): void {
  confirmingFlush.value = true
  flushError.value = null
  flushedJustNow.value = false
}

function cancelFlushConfirm(): void {
  confirmingFlush.value = false
}

async function confirmFlushCache(): Promise<void> {
  flushing.value = true
  flushError.value = null
  try {
    await flushCache()
    flushedJustNow.value = true
    confirmingFlush.value = false
    if (searchedDomain.value !== null) void browse(searchedDomain.value) // reflect the now-empty cache immediately
  } catch (err) {
    flushError.value = err instanceof AppApiError ? err.message : "Could not flush the cache."
  } finally {
    flushing.value = false
  }
}

// /api/cache/list is a tree browser, not a flat "give me this exact
// domain's records" lookup (same shape as /api/blocked/list and
// /api/allowed/list, confirmed live): a domain can have its own cached
// records, further cached subdomains (zones), both, or neither. An
// empty domain means "browse from the root" and is a valid, useful
// query on its own — not something to block.
async function browse(domain = domainInput.value.trim()): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listCache(domain, connection.credentials)
    records.value = res.response.records
    zones.value = res.response.zones
    domainInput.value = domain
    searchedDomain.value = domain
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not browse the cache."
    records.value = []
    zones.value = []
  } finally {
    loading.value = false
  }
}

function browseZone(zone: string): void {
  void browse(zone)
}

// The topbar refresh button re-browses whatever domain is currently
// shown (not whatever's been typed but not submitted) — there's
// nothing to refresh before a first search.
watch(
  () => refresh.tick,
  () => {
    if (searchedDomain.value === null) return // nothing browsed yet
    void browse(searchedDomain.value)
  },
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Cache</h1>
        <p class="mt-1 text-sm text-gray-500">Browse records your Technitium DNS server currently holds in memory</p>
      </div>
      <div v-if="auth.isAdmin && connection.isConfigured" class="flex flex-col items-end gap-1">
        <div v-if="confirmingFlush" class="flex items-center gap-1.5">
          <span class="text-[11.5px] text-crit">Clear the entire cache?</span>
          <button
            id="confirm-flush-cache"
            type="button"
            :disabled="flushing"
            class="text-[11.5px] font-semibold text-crit disabled:opacity-50"
            @click="confirmFlushCache"
          >
            {{ flushing ? "Flushing…" : "Confirm" }}
          </button>
          <button type="button" class="text-[11.5px] text-gray-500" @click="cancelFlushConfirm">Cancel</button>
        </div>
        <button
          v-else
          id="flush-cache"
          type="button"
          title="Clear all cached records — your DNS server will make recursive queries again to repopulate it"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-500 hover:text-crit"
          @click="startFlushConfirm"
        >
          Flush cache
        </button>
        <span v-if="flushedJustNow" class="text-[11px] text-ok">Cache flushed.</span>
        <span v-if="flushError" id="flush-cache-error" class="text-[11px] text-crit">{{ flushError }}</span>
      </div>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to
      browse the cache.
    </p>

    <template v-else>
      <form class="mb-4 flex items-end gap-2" @submit.prevent="browse()">
        <div class="flex-1">
          <label for="cache-domain" class="mb-1 block text-[11px] font-semibold text-gray-500">Domain</label>
          <input
            id="cache-domain"
            v-model="domainInput"
            placeholder="Leave blank to browse from the root, or enter a domain e.g. google.com"
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

      <template v-else-if="searchedDomain !== null">
        <div v-if="records.length === 0 && zones.length === 0" id="cache-empty" class="text-sm text-gray-500">
          Nothing cached
          <template v-if="searchedDomain">for <span class="font-mono">{{ searchedDomain }}</span></template
          ><template v-else>right now</template>.
        </div>

        <template v-else>
          <div v-if="zones.length > 0" class="mb-3">
            <p class="mb-1.5 text-[11px] font-semibold text-gray-500">
              {{ searchedDomain ? "Cached subdomains under this name" : "Cached top-level domains" }} &mdash;
              click to browse in
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="zone in zones"
                :key="zone"
                type="button"
                class="cache-zone-chip rounded-full border border-border px-2.5 py-1 font-mono text-[11.5px] text-gray-500 hover:border-accent hover:text-accent"
                @click="browseZone(zone)"
              >
                {{ zone }}
              </button>
            </div>
          </div>

          <div v-if="records.length > 0" class="overflow-x-auto rounded-lg border border-border">
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
    </template>
  </div>
</template>
