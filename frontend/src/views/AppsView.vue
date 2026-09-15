<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../stores/connection"
import { listApps, TechnitiumApiError, type DnsAppSummary } from "../api/technitium"

const connection = useConnectionStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const apps = ref<DnsAppSummary[]>([])

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listApps(connection.credentials)
    apps.value = res.response.apps
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load DNS apps."
  } finally {
    loading.value = false
  }
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
    <div class="mb-4">
      <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Apps</h1>
      <p class="mt-1 text-sm text-gray-500">Installed extensions that shape how this server resolves and blocks</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      installed apps.
    </p>
    <p v-else-if="loadError" id="apps-error" class="text-sm text-crit">{{ loadError }}</p>
    <p v-else-if="loading && apps.length === 0" class="text-sm text-gray-500">Loading…</p>

    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="app in apps" :key="app.name" class="rounded-lg border border-border bg-background-card p-3.5">
        <div class="flex items-start justify-between gap-2">
          <span class="text-[13px] font-semibold">{{ app.name }}</span>
          <span
            v-if="app.updateAvailable"
            class="whitespace-nowrap rounded-md bg-warn/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-warn"
          >
            Update to v{{ app.updateVersion }}
          </span>
          <span v-else class="whitespace-nowrap rounded-md bg-ok/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-ok">
            v{{ app.version }}
          </span>
        </div>
        <p class="mt-1.5 line-clamp-3 text-[11.5px] leading-relaxed text-gray-500">{{ app.description }}</p>
      </div>
    </div>
  </div>
</template>
