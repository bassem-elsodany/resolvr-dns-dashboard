<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { listDhcpScopes, listDhcpLeases, TechnitiumApiError, type DhcpScope, type DhcpLease } from "../../api/technitium"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()

const statsScope = useStatsScopeStore()

// DHCP scopes and leases are kept per node (they are not synced), so the
// page has one scope: the nodes whose DHCP is shown, merged with the node.
const targets = computed(() => statsScope.targets("dhcpPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("dhcpPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!

const loading = ref(false)
const loadError = ref<string | null>(null)
const nodeData = ref<{ name: string; scopes: DhcpScope[]; leases: DhcpLease[] }[]>([])
const failedNodes = ref<string[]>([])

// One flat list each, with the node on every row.
const scopes = computed(() => nodeData.value.flatMap((n) => n.scopes.map((s) => ({ ...s, node: n.name }))))
const leases = computed(() => nodeData.value.flatMap((n) => n.leases.map((l) => ({ ...l, node: n.name }))))

// The same scope name and range defined on more than one node: both can hand
// out addresses from it, so leases can clash unless the ranges are split.
const sharedScopes = computed(() => {
  if (!isCluster.value) return [] as string[]
  const seen = new Map<string, Set<string>>()
  for (const s of scopes.value) {
    const key = `${s.name}|${s.startingAddress}|${s.endingAddress}`
    seen.set(key, (seen.get(key) ?? new Set()).add(s.node))
  }
  return [...seen.entries()].filter(([, nodes]) => nodes.size > 1).map(([k]) => k.split("|")[0]!)
})

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const settled = await Promise.allSettled(
      targets.value.map(async (t) => {
        // The connected node is asked exactly as before; others are named.
        const [scopesRes, leasesRes] = await Promise.all(
          t.node
            ? [listDhcpScopes(connection.credentials, { node: t.node }), listDhcpLeases(connection.credentials, { node: t.node })]
            : [listDhcpScopes(connection.credentials), listDhcpLeases(connection.credentials)],
        )
        return { name: t.name, scopes: scopesRes.response.scopes, leases: leasesRes.response.leases }
      }),
    )
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
    if (ok.length === 0) {
      const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      throw first?.reason ?? new Error("No node answered")
    }
    nodeData.value = ok
    failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load DHCP data."
  } finally {
    loading.value = false
  }
}

const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("dhcpPage"), nodeNames.value]))
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
        <h1 class="text-lg font-semibold tracking-tight text-fg">DHCP</h1>
        <p class="mt-1 text-sm text-gray-500">Scopes and active leases on {{ isCluster ? "every node" : "this server" }}</p>
      </div>
      <ScopeChip v-if="connection.isConfigured" panel="dhcpPage" heading="Show DHCP on" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      DHCP data.
    </p>
    <p v-else-if="loadError" id="dhcp-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else>
      <p v-if="failedNodes.length" id="dhcp-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
        <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
      </p>
      <p v-if="sharedScopes.length" id="dhcp-shared" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px]">
        <span class="font-semibold">{{ sharedScopes.join(", ") }}</span>
        {{ sharedScopes.length === 1 ? "is" : "are" }} defined with the same range on more than one node. Both can hand out
        addresses from it, so clients may get clashing leases unless the ranges are split or DHCP failover is set up.
      </p>
      <div class="mb-6">
        <div class="mb-2 text-[13px] font-semibold">Scopes</div>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th v-if="isCluster" class="px-3 py-2 font-bold">Node</th>
                <th class="px-3 py-2 font-bold">Scope</th>
                <th class="px-3 py-2 font-bold">Range</th>
                <th class="px-3 py-2 font-bold">Subnet mask</th>
                <th class="px-3 py-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="scopes.length === 0">
                <td :colspan="isCluster ? 5 : 4" class="px-3 py-6 text-center text-gray-500">
                  {{ loading ? "Loading…" : "No DHCP scopes configured." }}
                </td>
              </tr>
              <tr v-for="scope in scopes" :key="`${scope.node}|${scope.name}`" class="border-b border-border last:border-b-0">
                <td v-if="isCluster" class="dhcp-node whitespace-nowrap px-3 py-2">
                  <span class="inline-flex items-center gap-1.5 font-mono text-xs">
                    <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(scope.node) }" />{{ shortName(scope.node) }}
                  </span>
                </td>
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
                <th v-if="isCluster" class="px-3 py-2 font-bold">Node</th>
                <th class="px-3 py-2 font-bold">Address</th>
                <th class="px-3 py-2 font-bold">Hostname</th>
                <th class="px-3 py-2 font-bold">Hardware address</th>
                <th class="px-3 py-2 font-bold">Scope</th>
                <th class="px-3 py-2 font-bold">Expires</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lease in leases" :key="`${lease.node}|${lease.hardwareAddress}`" class="border-b border-border last:border-b-0">
                <td v-if="isCluster" class="dhcp-node whitespace-nowrap px-3 py-2">
                  <span class="inline-flex items-center gap-1.5 font-mono text-xs">
                    <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(lease.node) }" />{{ shortName(lease.node) }}
                  </span>
                </td>
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
