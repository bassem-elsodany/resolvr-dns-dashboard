<script setup lang="ts">
import { ref } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { addServer, removeServer, updateServer, testServer, AppApiError } from "../../api/app"

const connection = useConnectionStore()

// Every server this dashboard observes is listed here: rename it in place,
// remove it, or add another. Each is checked against Technitium before it is
// saved, and all of them appear in the sidebar's server switcher.
const newName = ref("")
const newUrl = ref("")
const newToken = ref("")
const serverError = ref<string | null>(null)
const testResult = ref<string | null>(null)
const addingServer = ref(false)
const testingServer = ref(false)
// Names being edited, by server id; absent means "as saved".
const nameDrafts = ref<Record<number, string>>({})

function draftFor(id: number, saved: string): string {
  return nameDrafts.value[id] ?? saved
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof AppApiError ? err.message : fallback
}

function onCancelName(id: number) {
  delete nameDrafts.value[id]
}

// Saves a renamed server when its field loses focus. Unchanged or emptied
// names just go back to what is saved.
async function onSaveName(id: number, saved: string, baseUrl: string) {
  const name = nameDrafts.value[id]?.trim()
  if (!name || name === saved) {
    delete nameDrafts.value[id]
    return
  }
  serverError.value = null
  try {
    await updateServer(id, name)
    delete nameDrafts.value[id]
    await connection.loadServers()
  } catch (err) {
    serverError.value = `${baseUrl}: ${messageOf(err, "Could not rename the server.")}`
  }
}

async function onRemoveServer(id: number) {
  serverError.value = null
  try {
    await removeServer(id)
    delete nameDrafts.value[id]
    await connection.loadServers()
    // The server being observed may be the one that just went.
    if (connection.activeServerId === id) connection.selectServer(connection.servers[0]?.id ?? 0)
    else void connection.testConnection()
  } catch (err) {
    serverError.value = messageOf(err, "Could not remove the server.")
  }
}

async function onTestNewServer() {
  serverError.value = null
  testResult.value = null
  testingServer.value = true
  try {
    const res = await testServer(newUrl.value, newToken.value)
    testResult.value = `Works · ${res.serverDomain ?? "server"}${res.serverVersion ? ` · v${res.serverVersion}` : ""}`
  } catch (err) {
    serverError.value = messageOf(err, "Could not test the server.")
  } finally {
    testingServer.value = false
  }
}

async function onAddServer() {
  serverError.value = null
  testResult.value = null
  addingServer.value = true
  try {
    await addServer(newName.value, newUrl.value, newToken.value)
    newName.value = ""
    newUrl.value = ""
    newToken.value = ""
    await connection.loadServers()
    // The very first server: start observing it straight away.
    if (connection.status !== "connected") void connection.testConnection()
  } catch (err) {
    serverError.value = messageOf(err, "Could not add the server.")
  } finally {
    addingServer.value = false
  }
}
</script>

<template>
  <main class="max-w-xl px-6 py-16">
    <h1 class="text-2xl font-semibold tracking-tight">Servers</h1>
    <p class="mt-1 text-sm text-gray-500">
      The Technitium DNS servers Resolvr observes &mdash; saved here for everyone who signs into this
      dashboard, not just this browser. They need not form a cluster. Pick the one to look at with the
      switcher in the sidebar.
    </p>

    <ul v-if="connection.servers.length" id="server-list" class="mt-8 flex flex-col gap-2">
      <li
        v-for="s in connection.servers"
        :key="s.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background-card px-3 py-2 text-sm"
      >
        <div class="min-w-0 flex-1">
          <!-- The name reads as text and is edited in place: Enter or leaving the field saves it. -->
          <input
            :value="draftFor(s.id, s.name)"
            type="text"
            maxlength="80"
            :placeholder="s.id === connection.activeServerId && connection.serverDomain ? connection.serverDomain : 'Name'"
            :aria-label="`Name of ${s.baseUrl}`"
            title="Click to rename"
            class="-mx-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-fg hover:border-border-hover focus:border-accent focus:bg-background-canvas focus:outline-none"
            @input="nameDrafts[s.id] = ($event.target as HTMLInputElement).value"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            @keydown.esc.prevent="onCancelName(s.id)"
            @blur="onSaveName(s.id, s.name, s.baseUrl)"
          />
          <div class="truncate font-mono text-xs text-gray-500">{{ s.baseUrl }}</div>
          <div v-if="s.managed" class="mt-0.5 text-xs text-gray-500">
            Set in the add-on's Configuration tab in Home Assistant.
          </div>
        </div>
        <button
          v-if="!s.managed"
          type="button"
          class="flex-none text-xs font-semibold text-crit"
          :aria-label="`Remove ${s.name || s.baseUrl}`"
          @click="onRemoveServer(s.id)"
        >
          Remove
        </button>
      </li>
    </ul>
    <p v-else id="no-servers" class="mt-8 rounded-lg border border-border bg-background-card px-3 py-3 text-sm text-gray-500">
      No server yet. Add your Technitium server below.
    </p>

    <form class="mt-4 flex flex-col gap-3" @submit.prevent="onAddServer">
      <input
        id="new-server-name"
        v-model="newName"
        type="text"
        maxlength="80"
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
      <div class="flex flex-wrap items-center gap-3">
        <button
          id="add-server"
          type="submit"
          :disabled="addingServer || !newName.trim() || !newUrl.trim() || !newToken.trim()"
          class="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ addingServer ? "Adding…" : "Add server" }}
        </button>
        <button
          id="test-new-server"
          type="button"
          :disabled="testingServer || !newUrl.trim() || !newToken.trim()"
          class="inline-flex items-center gap-1.5 rounded-md border border-border-hover bg-background-card px-3.5 py-2 text-sm font-medium text-fg disabled:opacity-50"
          @click="onTestNewServer"
        >
          {{ testingServer ? "Testing…" : "Test" }}
        </button>
        <span
          v-if="testResult"
          id="test-result"
          class="inline-flex items-center gap-1.5 rounded-md bg-ok/12 px-2.5 py-1 text-xs font-semibold text-ok"
        >
          {{ testResult }}
        </span>
      </div>
      <p v-if="serverError" id="server-error" class="text-sm text-crit">{{ serverError }}</p>
    </form>

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
