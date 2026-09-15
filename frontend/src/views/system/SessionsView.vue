<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { listAdminSessions, TechnitiumApiError, type AdminSession } from "../../api/technitium"
import { revokeSession, AppApiError } from "../../api/app"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const sessions = ref<AdminSession[]>([])

const confirmingRevoke = ref<string | null>(null)
const revokeError = ref<string | null>(null)
const revoking = ref(false)

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

function startRevoke(partialToken: string): void {
  confirmingRevoke.value = partialToken
  revokeError.value = null
}

function cancelRevoke(): void {
  confirmingRevoke.value = null
}

async function confirmRevoke(partialToken: string): Promise<void> {
  revoking.value = true
  revokeError.value = null
  try {
    await revokeSession(partialToken)
    confirmingRevoke.value = null
    await load()
  } catch (err) {
    revokeError.value = err instanceof AppApiError ? err.message : "Could not revoke the session."
  } finally {
    revoking.value = false
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
    <div class="mb-4">
      <h1 class="text-lg font-semibold tracking-tight text-fg">Sessions</h1>
      <p class="mt-1 text-sm text-gray-500">Who and what is currently authenticated to this server</p>
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
              <th v-if="auth.isAdmin" class="px-3 py-2 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sessions.length === 0">
              <td :colspan="auth.isAdmin ? 6 : 5" class="px-3 py-6 text-center text-gray-500">
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
              <td v-if="auth.isAdmin" class="px-3 py-2">
                <span v-if="session.isCurrentSession" class="text-[11px] text-gray-500">&ndash;</span>
                <div v-else-if="confirmingRevoke === session.partialToken" class="flex items-center gap-1.5">
                  <button
                    type="button"
                    :disabled="revoking"
                    class="text-[11.5px] font-semibold text-crit disabled:opacity-50"
                    @click="confirmRevoke(session.partialToken)"
                  >
                    {{ revoking ? "Revoking…" : "Confirm" }}
                  </button>
                  <button type="button" class="text-[11.5px] text-gray-500" @click="cancelRevoke">Cancel</button>
                </div>
                <button
                  v-else
                  type="button"
                  class="revoke-session text-[11.5px] font-medium text-crit"
                  @click="startRevoke(session.partialToken)"
                >
                  Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="revokeError" id="revoke-session-error" class="mt-2 text-sm text-crit">{{ revokeError }}</p>

      <p class="mt-3 max-w-[70ch] text-[11px] leading-relaxed text-gray-500">
        Revoking a session ends it immediately &mdash; the associated user or API token will need to
        sign in again.
      </p>
    </template>
  </div>
</template>
