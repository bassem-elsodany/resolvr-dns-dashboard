<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../stores/connection"
import { listAdminSessions, TechnitiumApiError, type AdminSession } from "../api/technitium"

const connection = useConnectionStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const sessions = ref<AdminSession[]>([])

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await listAdminSessions(connection.credentials)
    sessions.value = res.response.sessions
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load sessions."
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
      <h1 class="text-lg font-semibold tracking-tight text-fg">Sessions</h1>
      <p class="mt-1 text-sm text-gray-500">Who and what is currently authenticated to this server &mdash; view only</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      sessions.
    </p>
    <p v-else-if="loadError" id="sessions-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else>
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-left text-[12.5px]">
          <thead>
            <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
              <th class="px-3 py-2 font-bold">User</th>
              <th class="px-3 py-2 font-bold">Token / session name</th>
              <th class="px-3 py-2 font-bold">Type</th>
              <th class="px-3 py-2 font-bold">Last used</th>
              <th class="px-3 py-2 font-bold">From</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sessions.length === 0">
              <td colspan="5" class="px-3 py-6 text-center text-gray-500">
                {{ loading ? "Loading…" : "No active sessions." }}
              </td>
            </tr>
            <tr
              v-for="session in sessions"
              :key="session.partialToken"
              class="border-b border-border last:border-b-0"
              :class="session.isCurrentSession ? 'bg-accent/7' : ''"
            >
              <td class="px-3 py-2">
                {{ session.username }}
                <span v-if="session.isCurrentSession" class="ml-1 text-[10.5px] text-accent">(this session)</span>
              </td>
              <td class="px-3 py-2 font-mono text-gray-500">{{ session.tokenName ?? session.partialToken }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                  :class="session.type === 'ApiToken' ? 'bg-info/12 text-info' : 'bg-background-hover text-gray-500'"
                >
                  {{ session.type === "ApiToken" ? "API token" : "Session" }}
                </span>
              </td>
              <td class="px-3 py-2 text-gray-500">{{ new Date(session.lastSeen).toLocaleString() }}</td>
              <td class="px-3 py-2 font-mono text-gray-500">{{ session.lastSeenRemoteAddress }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="mt-3 max-w-[70ch] text-[11px] leading-relaxed text-gray-500">
        Resolvr only reads this list &mdash; revoking a token or ending a session still has to be
        done from the Technitium web console.
      </p>
    </template>
  </div>
</template>
