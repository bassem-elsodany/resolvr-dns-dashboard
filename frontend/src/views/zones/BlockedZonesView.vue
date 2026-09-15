<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { listBlockedZones, exportBlockedZones, getSettings, TechnitiumApiError } from "../../api/technitium"
import { updateBlockListUrls, AppApiError } from "../../api/app"
import { triggerDownload } from "../../lib/download"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()

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

// Admin editing — the raw list (comments and URLs, in order) is edited
// as plain text, one entry per line, mirroring exactly what's stored:
// Technitium doesn't distinguish them structurally, an admin's own "#
// Some Label" line is just another string in the same array.
const editingSources = ref(false)
const editSourcesText = ref("")
const savingSources = ref(false)
const saveSourcesError = ref<string | null>(null)
const sourcesSavedJustNow = ref(false)

function startEditSources(): void {
  editSourcesText.value = blockListLines.value.map((l) => l.text).join("\n")
  saveSourcesError.value = null
  sourcesSavedJustNow.value = false
  editingSources.value = true
}

function cancelEditSources(): void {
  editingSources.value = false
}

async function saveSources(): Promise<void> {
  savingSources.value = true
  saveSourcesError.value = null
  try {
    const urls = editSourcesText.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    await updateBlockListUrls(urls)
    await loadBlockListConfig()
    editingSources.value = false
    sourcesSavedJustNow.value = true
  } catch (err) {
    saveSourcesError.value = err instanceof AppApiError ? err.message : "Could not save block list sources."
  } finally {
    savingSources.value = false
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
      <div
        v-if="blockListLines.length > 0 || configLoadError || auth.isAdmin"
        class="mb-4 rounded-lg border border-border bg-background-card p-3.5"
      >
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
          <button
            v-if="auth.isAdmin && !editingSources"
            id="edit-block-list-sources"
            type="button"
            class="ml-auto text-[11.5px] font-semibold text-accent"
            @click="startEditSources"
          >
            Edit
          </button>
        </div>
        <p class="mb-2 text-[11px] text-gray-500">
          The feeds this server downloads and merges into its block list zone &mdash; one entry per
          line; lines starting with <span class="font-mono">#</span> are your own group labels, not
          sent to Technitium as feeds.
        </p>

        <div v-if="editingSources" class="flex flex-col gap-2">
          <textarea
            id="block-list-sources-editor"
            v-model="editSourcesText"
            rows="10"
            spellcheck="false"
            class="w-full rounded-md border border-border bg-background-card px-2.5 py-2 font-mono text-[11.5px]"
          />
          <div class="flex items-center gap-2">
            <button
              id="save-block-list-sources"
              type="button"
              :disabled="savingSources"
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              @click="saveSources"
            >
              {{ savingSources ? "Saving…" : "Save" }}
            </button>
            <button type="button" class="text-xs text-gray-500" @click="cancelEditSources">Cancel</button>
          </div>
          <p v-if="saveSourcesError" id="block-list-sources-save-error" class="text-xs text-crit">
            {{ saveSourcesError }}
          </p>
        </div>
        <template v-else>
          <p v-if="configLoadError" id="block-list-sources-error" class="text-sm text-crit">{{ configLoadError }}</p>
          <p v-else-if="sourcesSavedJustNow" class="mb-1 text-[11px] text-ok">Saved.</p>
          <ul
            v-if="!configLoadError && blockListLines.length > 0"
            id="block-list-sources"
            class="flex flex-col gap-0.5 text-[11.5px]"
          >
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
          <p v-else-if="!configLoadError" class="text-[11.5px] text-gray-500">No block list feeds configured.</p>
        </template>
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
