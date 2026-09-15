<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../stores/connection"
import { listDhcpScopes, listDhcpLeases, TechnitiumApiError, type DhcpScope, type DhcpLease } from "../api/technitium"

const connection = useConnectionStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const scopes = ref<DhcpScope[]>([])
const leases = ref<DhcpLease[]>([])

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const [scopesRes, leasesRes] = await Promise.all([
      listDhcpScopes(connection.credentials),
      listDhcpLeases(connection.credentials),
    ])
    scopes.value = scopesRes.response.scopes
    leases.value = leasesRes.response.leases
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load DHCP data."
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
      <h1 class="text-lg font-semibold tracking-tight text-fg">DHCP</h1>
      <p class="mt-1 text-sm text-gray-500">Scopes and active leases on this server</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      DHCP data.
    </p>
    <p v-else-if="loadError" id="dhcp-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else>
      <div class="mb-6">
        <div class="mb-2 text-[13px] font-semibold">Scopes</div>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-3 py-2 font-bold">Scope</th>
                <th class="px-3 py-2 font-bold">Range</th>
                <th class="px-3 py-2 font-bold">Subnet mask</th>
                <th class="px-3 py-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="scopes.length === 0">
                <td colspan="4" class="px-3 py-6 text-center text-gray-500">
                  {{ loading ? "Loading…" : "No DHCP scopes configured." }}
                </td>
              </tr>
              <tr v-for="scope in scopes" :key="scope.name" class="border-b border-border last:border-b-0">
                <td class="px-3 py-2">{{ scope.name }}</td>
                <td class="px-3 py-2 font-mono text-gray-500">
                  {{ scope.startingAddress }} &ndash; {{ scope.endingAddress }}
                </td>
                <td class="px-3 py-2 font-mono text-gray-500">{{ scope.subnetMask }}</td>
                <td class="px-3 py-2">
                  <span
                    class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                    :class="scope.enabled ? 'bg-ok/12 text-ok' : 'bg-background-hover text-gray-500'"
                  >
                    {{ scope.enabled ? "Enabled" : "Disabled" }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="mb-2 text-[13px] font-semibold">Active leases</div>
        <div v-if="leases.length === 0" id="dhcp-leases-empty" class="rounded-lg border border-border py-8 text-center text-sm text-gray-500">
          No active leases.
        </div>
        <div v-else class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-3 py-2 font-bold">Address</th>
                <th class="px-3 py-2 font-bold">Hostname</th>
                <th class="px-3 py-2 font-bold">Hardware address</th>
                <th class="px-3 py-2 font-bold">Scope</th>
                <th class="px-3 py-2 font-bold">Expires</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lease in leases" :key="lease.hardwareAddress" class="border-b border-border last:border-b-0">
                <td class="px-3 py-2 font-mono">{{ lease.address }}</td>
                <td class="px-3 py-2 text-gray-500">{{ lease.hostName ?? "–" }}</td>
                <td class="px-3 py-2 font-mono text-gray-500">{{ lease.hardwareAddress }}</td>
                <td class="px-3 py-2 text-gray-500">{{ lease.scope }}</td>
                <td class="px-3 py-2 text-gray-500">{{ new Date(lease.leaseExpires).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
