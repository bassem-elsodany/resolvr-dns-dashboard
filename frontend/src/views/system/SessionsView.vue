<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useAuthStore } from "../../stores/auth"
import { listAdminSessions, TechnitiumApiError, type AdminSession } from "../../api/technitium"
import { revokeSession, AppApiError } from "../../api/app"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const auth = useAuthStore()

const statsScope = useStatsScopeStore()

// Sessions are kept per node, so the page merges the nodes' sessions and
// shows which node each one is on. Revoking ends it on that node.
const targets = computed(() => statsScope.targets("sessionsPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("sessionsPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!

const loading = ref(false)
const loadError = ref<string | null>(null)
type SessionRow = AdminSession & { node: string }
const sessions = ref<SessionRow[]>([])
const failedNodes = ref<string[]>([])
const nodeOfToken = (row: { node: string }): string | undefined => targets.value.find((t) => t.name === row.node)?.node

const confirmingRevoke = ref<string | null>(null)
const revokeError = ref<string | null>(null)
const revoking = ref(false)

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const settled = await Promise.allSettled(
      targets.value.map(async (t) => {
        const res = t.node ? await listAdminSessions(connection.credentials, { node: t.node }) : await listAdminSessions(connection.credentials)
        return res.response.sessions.map((s) => ({ ...s, node: t.name }))
      }),
    )
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
    if (ok.length === 0) {
      const firstFail = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      throw firstFail?.reason ?? new Error("No node answered")
    }
    sessions.value = ok.flat()
    failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
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

async function confirmRevoke(partialToken: string, node?: string): Promise<void> {
  revoking.value = true
  revokeError.value = null
  try {
    await (node ? revokeSession(partialToken, node) : revokeSession(partialToken))
    confirmingRevoke.value = null
    await load()
  } catch (err) {
    revokeError.value = err instanceof AppApiError ? err.message : "Could not revoke the session."
  } finally {
    revoking.value = false
  }
}

const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("sessionsPage"), nodeNames.value]))
watch(scopeKey, () => void load())

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
        <h1 class="text-lg font-semibold tracking-tight text-fg">Sessions</h1>
        <p class="mt-1 text-sm text-gray-500">Who and what is currently authenticated to {{ isCluster ? "each node" : "this server" }}</p>
      </div>
      <ScopeChip v-if="connection.isConfigured" panel="sessionsPage" heading="Show sessions on" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      sessions.
    </p>
    <p v-else-if="loadError" id="sessions-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else>
      <p v-if="failedNodes.length" id="sessions-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
        <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
      </p>
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-left text-[12.5px]">
          <thead>
            <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
              <th v-if="isCluster" class="px-3 py-2 font-bold">Node</th>
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
              <td :colspan="(auth.isAdmin ? 6 : 5) + (isCluster ? 1 : 0)" class="px-3 py-6 text-center text-gray-500">
                {{ loading ? "Loading…" : "No active sessions." }}
              </td>
            </tr>
            <tr
              v-for="session in sessions"
              :key="`${session.node}|${session.partialToken}`"
              class="border-b border-border last:border-b-0"
              :class="session.isCurrentSession ? 'bg-accent/7' : ''"
            >
              <td v-if="isCluster" class="session-node whitespace-nowrap px-3 py-2">
                <span class="inline-flex items-center gap-1.5 font-mono text-xs">
                  <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(session.node) }" />{{ shortName(session.node) }}
                </span>
              </td>
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
                <div v-else-if="confirmingRevoke === `${session.node}|${session.partialToken}`" class="flex items-center gap-1.5">
                  <button
                    type="button"
                    :disabled="revoking"
                    class="text-[11.5px] font-semibold text-crit disabled:opacity-50"
                    @click="confirmRevoke(session.partialToken, nodeOfToken(session))"
                  >
                    {{ revoking ? "Revoking…" : "Confirm" }}
                  </button>
                  <button type="button" class="text-[11.5px] text-gray-500" @click="cancelRevoke">Cancel</button>
                </div>
                <button
                  v-else
                  type="button"
                  class="revoke-session text-[11.5px] font-medium text-crit"
                  @click="startRevoke(`${session.node}|${session.partialToken}`)"
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
