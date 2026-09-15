<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { listBlockedZones, exportBlockedZones, getSettings, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"

const connection = useConnectionStore()
const refresh = useRefreshStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const domains = ref<string[]>([])
const filterText = ref("")

interface BlockListLine {
  kind: "comment" | "url"
  text: string
}

const enableBlocking = ref<boolean | null>(null)
const blockingType = ref<string | null>(null)
const blockListLines = ref<BlockListLine[]>([])
const configLoadError = ref<string | null>(null)

// Lines starting with "#" are the admin's own grouping labels inside
// the blockListUrls list (confirmed live — e.g. "# Hagezi PRO++" above
// the URL it labels) — render them as sub-headers, not list items.
function toBlockListLines(urls: string[]): BlockListLine[] {
  return urls.map((line) => ({ kind: line.trim().startsWith("#") ? "comment" : "url", text: line.trim() }))
}

async function loadBlockListConfig(): Promise<void> {
  if (!connection.isConfigured) return
  configLoadError.value = null
  try {
    const res = await getSettings(connection.credentials)
    enableBlocking.value = res.response.enableBlocking ?? null
    blockingType.value = res.response.blockingType ?? null
    blockListLines.value = toBlockListLines(res.response.blockListUrls ?? [])
  } catch (err) {
    configLoadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load block list sources."
  }
}

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
    const res = await listBlockedZones(connection.credentials)
    // Same tree-browser shape as /api/allowed/list (see AllowedZonesView) —
    // fall back to record names if the root call ever auto-descends.
    if (res.response.zones.length > 0) {
      domains.value = res.response.zones
    } else {
      domains.value = [...new Set(res.response.records.map((r) => r.name))]
    }
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load blocked zones."
  } finally {
    loading.value = false
  }
}

async function onExport(): Promise<void> {
  try {
    triggerDownload(await exportBlockedZones(connection.credentials))
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not export blocked zones."
  }
}

onMounted(() => {
  load()
  loadBlockListConfig()
})
watch(() => refresh.tick, load)
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) {
      load()
      loadBlockListConfig()
    }
  },
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-fg">Blocked Zones</h1>
        <p class="mt-1 text-sm text-gray-500">
          Zones denied by the server's built-in blocking &mdash; independent from the Advanced
          Blocking app's block lists
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="blocked-filter"
          v-model="filterText"
          placeholder="Filter&hellip;"
          class="w-44 rounded-md border border-border bg-background-card px-3 py-1.5 text-sm"
        />
        <button
          id="export-blocked"
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
      blocked zones.
    </p>

    <template v-else>
      <div v-if="blockListLines.length > 0 || configLoadError" class="mb-4 rounded-lg border border-border bg-background-card p-3.5">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <div class="text-[12.5px] font-semibold">Block list sources</div>
          <span
            v-if="enableBlocking !== null"
            class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
            :class="enableBlocking ? 'bg-ok/12 text-ok' : 'bg-gray-500/12 text-gray-500'"
          >
            {{ enableBlocking ? "Blocking enabled" : "Blocking disabled" }}
          </span>
          <span v-if="blockingType" class="text-[10.5px] text-gray-500">&middot; {{ blockingType }}</span>
        </div>
        <p class="mb-2 text-[11px] text-gray-500">
          The feeds this server downloads and merges into its block list zone &mdash; managed from the
          Technitium web console's Settings &gt; Blocking section.
        </p>
        <p v-if="configLoadError" id="block-list-sources-error" class="text-sm text-crit">{{ configLoadError }}</p>
        <ul v-else id="block-list-sources" class="flex flex-col gap-0.5 text-[11.5px]">
          <li
            v-for="(line, i) in blockListLines"
            :key="i"
            :class="
              line.kind === 'comment'
                ? 'mt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 first:mt-0'
                : 'truncate font-mono text-fg'
            "
          >
            <a
              v-if="line.kind === 'url'"
              :href="line.text"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-accent hover:underline"
              >{{ line.text }}</a
            >
            <template v-else>{{ line.text.replace(/^#\s*/, "") }}</template>
          </li>
        </ul>
      </div>
    </template>

    <p v-if="loadError" id="blocked-error" class="text-sm text-crit">{{ loadError }}</p>

    <div v-if="connection.isConfigured && !loadError" class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-left text-[12.5px]">
        <thead>
          <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
            <th class="px-3 py-2 font-bold">Domain</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredDomains.length === 0">
            <td class="px-3 py-6 text-center text-gray-500">
              {{ loading ? "Loading…" : "No blocked zones." }}
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
