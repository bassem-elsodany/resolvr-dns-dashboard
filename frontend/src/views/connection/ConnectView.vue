<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { getServerConfig } from "../../api/app"

const connection = useConnectionStore()
const baseUrlInput = ref("")
const tokenInput = ref("")

// Loads the currently saved connection details (this page is
// admin-only — see the router guard — so it's safe to fetch the raw
// token here) to prefill the form for editing.
onMounted(async () => {
  try {
    const config = await getServerConfig()
    baseUrlInput.value = config.baseUrl
    tokenInput.value = config.token
  } catch {
    // No config saved yet, or it couldn't be loaded — leave the form
    // blank rather than blocking the page on it.
  }
})

async function onTestConnection() {
  await connection.setConfig(baseUrlInput.value, tokenInput.value)
}

// AppShell.vue re-validates the saved connection on mount (it's always
// mounted, unlike this view) — no need to duplicate that here, which
// would just double the request when the user is actually on this page.
</script>

<template>
  <main class="mx-auto max-w-xl px-6 py-16">
    <h1 class="text-2xl font-semibold tracking-tight">Connection Settings</h1>
    <p class="mt-1 text-sm text-gray-500">
      Point Resolvr at your Technitium DNS Server &mdash; saved here for everyone who signs into this
      dashboard, not just this browser.
    </p>

    <form class="mt-8 flex flex-col gap-4" @submit.prevent="onTestConnection">
      <div class="flex flex-col gap-1.5">
        <label for="server-url" class="text-xs font-semibold text-gray-500">Server URL</label>
        <input
          id="server-url"
          v-model="baseUrlInput"
          type="text"
          placeholder="http://10.0.60.60:5380"
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

    <p class="mt-8 text-xs leading-relaxed text-gray-500">
      Resolvr only calls read endpoints &mdash; dashboard stats, zone &amp; record listings, query
      logs, cache, DHCP, apps and settings. It never creates, edits or deletes anything on your DNS
      server.
    </p>
  </main>
</template>
