<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { getServerConfig, addServer, removeServer, AppApiError } from "../../api/app"

const connection = useConnectionStore()
const baseUrlInput = ref("")
const tokenInput = ref("")
// Set when the connection comes from the Home Assistant add-on's
// Configuration tab, which then owns it.
const managed = ref(false)

// Loads the currently saved connection details (this page is
// admin-only — see the router guard — so it's safe to fetch the raw
// token here) to prefill the form for editing.
onMounted(async () => {
  try {
    const config = await getServerConfig()
    baseUrlInput.value = config.baseUrl
    tokenInput.value = config.token
    managed.value = config.managed === true
  } catch {
    // No config saved yet, or it couldn't be loaded — leave the form
    // blank rather than blocking the page on it.
  }
})

// Further servers to observe next to the primary connection above. Each is
// checked against Technitium before it is saved, and appears in the sidebar's
// server switcher for everyone who signs in.
const newName = ref("")
const newUrl = ref("")
const newToken = ref("")
const serverError = ref<string | null>(null)
const addingServer = ref(false)
const extraServers = computed(() => connection.servers.filter((s) => !s.primary))

async function onAddServer() {
  serverError.value = null
  addingServer.value = true
  try {
    await addServer(newName.value, newUrl.value, newToken.value)
    newName.value = ""
    newUrl.value = ""
    newToken.value = ""
    await connection.loadServers()
  } catch (err) {
    serverError.value = err instanceof AppApiError ? err.message : "Could not add the server."
  } finally {
    addingServer.value = false
  }
}

async function onRemoveServer(id: number) {
  serverError.value = null
  try {
    await removeServer(id)
    await connection.loadServers()
  } catch (err) {
    serverError.value = err instanceof AppApiError ? err.message : "Could not remove the server."
  }
}

async function onTestConnection() {
  await connection.setConfig(baseUrlInput.value, tokenInput.value)
}

// AppShell.vue re-validates the saved connection on mount (it's always
// mounted, unlike this view) — no need to duplicate that here, which
// would just double the request when the user is actually on this page.
</script>

<template>
  <main class="max-w-xl px-6 py-16">
    <h1 class="text-2xl font-semibold tracking-tight">Connection Settings</h1>
    <p class="mt-1 text-sm text-gray-500">
      Point Resolvr at your Technitium DNS Server &mdash; saved here for everyone who signs into this
      dashboard, not just this browser.
    </p>

    <div v-if="managed" id="connection-managed" class="mt-8 rounded-lg border border-border bg-background-card px-4 py-3.5 text-sm">
      <div class="text-xs font-semibold text-gray-500">Server URL</div>
      <div class="mt-0.5 font-mono">{{ baseUrlInput }}</div>
      <p class="mt-3 text-gray-500">
        This connection is set in the add-on's <b class="text-fg">Configuration</b> tab in Home Assistant, together with the API token.
        Change it there and restart the add-on.
      </p>
    </div>

    <form v-else class="mt-8 flex flex-col gap-4" @submit.prevent="onTestConnection">
      <div class="flex flex-col gap-1.5">
        <label for="server-url" class="text-xs font-semibold text-gray-500">Server URL</label>
        <input
          id="server-url"
          v-model="baseUrlInput"
          type="text"
          placeholder="http://192.168.1.53:5380"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="api-token" class="text-xs font-semibold text-gray-500">API token</label>
        <input
          id="api-token"
          v-model="tokenInput"
          type="password"
          placeholder="Paste your Technitium API token"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div class="flex items-center gap-3">
        <button
          id="test-connection"
          type="submit"
          :disabled="connection.status === 'testing'"
          class="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ connection.status === "testing" ? "Testing…" : "Test connection" }}
        </button>

        <span
          v-if="connection.status === 'connected'"
          class="inline-flex items-center gap-1.5 rounded-md bg-ok/12 px-2.5 py-1 text-xs font-semibold text-ok"
        >
          Connected &middot; {{ connection.serverDomain }} &middot; v{{ connection.serverVersion }}
        </span>
      </div>

      <p
        v-if="connection.status === 'error' && connection.error"
        id="connection-error"
        class="text-sm text-crit"
      >
        {{ connection.error }}
      </p>
    </form>

    <section id="more-servers" class="mt-12 border-t border-border pt-8">
      <h2 class="text-lg font-semibold tracking-tight">More servers</h2>
      <p class="mt-1 text-sm text-gray-500">
        Observe other Technitium servers from this same dashboard &mdash; for example separate instances
        that are not in one cluster. Pick the one to look at with the switcher in the sidebar.
      </p>

      <ul v-if="extraServers.length" class="mt-4 flex flex-col gap-2">
        <li
          v-for="s in extraServers"
          :key="s.id"
          class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background-card px-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <div class="truncate font-semibold">{{ s.name }}</div>
            <div class="truncate font-mono text-xs text-gray-500">{{ s.baseUrl }}</div>
          </div>
          <button
            type="button"
            class="flex-none text-xs font-semibold text-crit"
            :aria-label="`Remove ${s.name}`"
            @click="onRemoveServer(s.id)"
          >
            Remove
          </button>
        </li>
      </ul>

      <form class="mt-4 flex flex-col gap-3" @submit.prevent="onAddServer">
        <input
          id="new-server-name"
          v-model="newName"
          type="text"
          placeholder="Name, e.g. Segment 129"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <input
          id="new-server-url"
          v-model="newUrl"
          type="text"
          placeholder="http://192.168.1.54:5380"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <input
          id="new-server-token"
          v-model="newToken"
          type="password"
          placeholder="API token"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <div>
          <button
            id="add-server"
            type="submit"
            :disabled="addingServer"
            class="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {{ addingServer ? "Checking…" : "Add server" }}
          </button>
        </div>
        <p v-if="serverError" id="server-error" class="text-sm text-crit">{{ serverError }}</p>
      </form>
    </section>

    <div class="mt-8 max-w-[62ch] text-xs leading-relaxed text-gray-500">
      <p>
        Almost everything Resolvr does is read-only &mdash; dashboard stats, zone &amp; record
        listings, query logs, cache, DHCP, apps and settings. It never edits a zone or record on your
        DNS server.
      </p>
      <p class="mt-2">
        A short, explicit list of admin-only actions is the exception, each a single confirmed call to
        one specific Technitium endpoint, never a general write:
      </p>
      <ul class="mt-1.5 list-disc space-y-0.5 pl-4">
        <li>Flush the DNS cache</li>
        <li>Force an immediate block-list update</li>
        <li>Edit the block list source URLs, or block/unblock a specific domain</li>
        <li>Revoke a session or API token</li>
        <li>Uninstall a DNS app</li>
      </ul>
      <p class="mt-2">A Viewer account cannot do any of these &mdash; only read every monitoring page.</p>
    </div>
  </main>
</template>
