<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import { getSettings, getClusterState, TechnitiumApiError, type ClusterNode, type DnsSettings } from "../../api/technitium"
import { CLUSTER, NODE_COLORS, useStatsScopeStore } from "../../stores/statsScope"
import { settingsRows, differingCount } from "../../lib/serverCompare"
import ScopeChip from "../../components/overview/ScopeChip.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()
const serverUpdate = useServerUpdateStore()

const statsScope = useStatsScopeStore()

// Each node has its own settings and version, so the page lays the nodes
// side by side and marks what differs; the cluster itself gets a card.
const targets = computed(() => statsScope.targets("serverPage"))
const isCluster = computed(() => statsScope.available && statsScope.scopeOf("serverPage") === CLUSTER)
const nodeNames = computed(() => targets.value.map((t) => t.name))
const shortName = (name: string): string => (name ? name.split(".")[0]! : "this node")
const colorOf = (name: string): string => NODE_COLORS[Math.max(0, statsScope.nodeNames.indexOf(name)) % NODE_COLORS.length]!

const loading = ref(false)
const loadError = ref<string | null>(null)
const perNode = ref<Record<string, DnsSettings>>({})
const failedNodes = ref<string[]>([])
const clusterNodes = ref<ClusterNode[]>([])
const clusterDomain = ref<string | null>(null)
const onlyDifferences = ref(false)

// The node shown in the single-node cards: the one scoped, or the first.
const settings = computed<DnsSettings | null>(() => perNode.value[nodeNames.value[0] ?? ""] ?? Object.values(perNode.value)[0] ?? null)
const compare = computed(() => settingsRows(perNode.value, nodeNames.value))
const differences = computed(() => differingCount(compare.value))
const shownRows = computed(() => (onlyDifferences.value ? compare.value.filter((r) => r.differs) : compare.value))

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const settled = await Promise.allSettled(
      targets.value.map(async (t) => {
        const res = t.node ? await getSettings(connection.credentials, { node: t.node }) : await getSettings(connection.credentials)
        return { name: t.name, settings: res.response }
      }),
    )
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
    if (ok.length === 0) {
      const firstFail = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      throw firstFail?.reason ?? new Error("No node answered")
    }
    perNode.value = Object.fromEntries(ok.map((o) => [o.name, o.settings]))
    failedNodes.value = settled.flatMap((s, i) => (s.status === "rejected" ? [targets.value[i]!.name] : []))
    if (isCluster.value) {
      try {
        const cs = await getClusterState(connection.credentials)
        clusterNodes.value = cs.response.clusterNodes ?? []
        clusterDomain.value = cs.response.clusterDomain ?? null
      } catch {
        clusterNodes.value = []
      }
    } else {
      clusterNodes.value = []
    }
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load server settings."
  } finally {
    loading.value = false
  }
}

const scopeKey = computed(() => JSON.stringify([statsScope.nodeParam("serverPage"), nodeNames.value]))
watch(scopeKey, () => {
  onlyDifferences.value = false
  void load()
})

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
        <h1 class="text-lg font-semibold tracking-tight text-fg">Server Info</h1>
        <p class="mt-1 text-sm text-gray-500">
          Read-only snapshot of {{ isCluster ? "each node's" : "this node's" }} configuration
        </p>
      </div>
      <ScopeChip v-if="connection.isConfigured" panel="serverPage" heading="Show settings of" />
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      its settings.
    </p>
    <p v-else-if="loadError" id="server-info-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else-if="settings">
      <div
        v-if="serverUpdate.updateAvailable"
        id="update-banner"
        class="mb-4 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2.5 text-[12.5px]"
      >
        {{ serverUpdate.updateTitle ?? "A newer version of Technitium DNS Server is available" }}
        <span v-if="serverUpdate.updateVersion" class="font-semibold">&mdash; v{{ serverUpdate.updateVersion }}</span>
      </div>

      <p v-if="failedNodes.length" id="server-partial" class="mb-3 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2 text-[12.5px] font-medium">
        <span class="font-mono">{{ failedNodes.join(", ") }}</span> could not be read, so this is partial.
      </p>

      <template v-if="isCluster">
        <div id="cluster-card" class="mb-3.5 rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span class="text-[12.5px] font-semibold">Cluster</span>
            <span v-if="clusterDomain" class="font-mono text-xs text-gray-500">{{ clusterDomain }}</span>
          </div>
          <div class="flex flex-col">
            <div
              v-for="n in clusterNodes"
              :key="n.name"
              class="cluster-node flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-2 text-[12.5px] first:border-t-0"
            >
              <span class="inline-flex min-w-[10rem] flex-1 items-center gap-2 font-mono">
                <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: colorOf(n.name) }" />{{ n.name }}
              </span>
              <span class="rounded-full bg-background-hover px-2 py-0.5 text-[11.5px] font-semibold">{{ n.type }}</span>
              <span class="inline-flex items-center gap-1.5 text-xs" :class="n.state === 'Unreachable' ? 'font-semibold text-crit' : 'text-gray-500'">
                <span class="h-2 w-2 rounded-full" :class="n.state === 'Unreachable' ? 'bg-crit' : 'bg-ok'" />
                {{ n.state === "Unreachable" ? "Unreachable" : "Connected" }}
              </span>
              <span v-if="n.version" class="tabular-nums text-gray-500">v{{ n.version }}</span>
            </div>
          </div>
        </div>

        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span
            id="settings-differences"
            class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            :class="differences === 0 ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn'"
          >
            {{ differences === 0 ? "Every setting matches" : `${differences} ${differences === 1 ? "setting differs" : "settings differ"} between nodes` }}
          </span>
          <label v-if="differences > 0" class="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <input v-model="onlyDifferences" type="checkbox" id="only-differences" /> Show only differences
          </label>
        </div>
        <div class="overflow-x-auto rounded-lg border border-border bg-background-card">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
                <th class="px-3 py-2 font-bold">Setting</th>
                <th v-for="n in nodeNames" :key="n" class="px-3 py-2 font-bold">
                  <span class="mr-1.5 inline-block h-2 w-2 rounded-sm" :style="{ background: colorOf(n) }" />{{ shortName(n) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in shownRows"
                :key="r.section + r.label"
                class="setting-row border-b border-border last:border-b-0"
                :class="r.differs ? 'bg-warn/7' : ''"
              >
                <td class="px-3 py-1.5 text-gray-500">
                  <span class="mr-2 text-[10.5px] uppercase tracking-wide text-gray-500/70">{{ r.section }}</span>{{ r.label }}
                </td>
                <td v-for="(v, i) in r.values" :key="i" class="px-3 py-1.5 font-mono" :class="r.differs ? 'font-semibold text-warn' : ''">{{ v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Identity</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Server domain</dt>
            <dd class="font-mono">{{ settings.dnsServerDomain }}</dd>
            <dt class="text-gray-500">Version</dt>
            <dd>{{ settings.version }}</dd>
            <dt class="text-gray-500">Uptime since</dt>
            <dd>{{ new Date(settings.uptimestamp).toLocaleString() }}</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Resolution</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Listening on</dt>
            <dd class="font-mono">{{ settings.dnsServerLocalEndPoints.join(", ") }}</dd>
            <dt class="text-gray-500">IPv6 mode</dt>
            <dd>{{ settings.ipv6Mode }}</dd>
            <dt class="text-gray-500">DNSSEC validation</dt>
            <dd>
              <span
                class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                :class="settings.dnssecValidation ? 'bg-ok/12 text-ok' : 'bg-background-hover text-gray-500'"
              >
                {{ settings.dnssecValidation ? "Enabled" : "Disabled" }}
              </span>
            </dd>
            <dt class="text-gray-500">EDNS client subnet</dt>
            <dd>{{ settings.eDnsClientSubnet ? "Enabled" : "Disabled" }}</dd>
            <dt class="text-gray-500">UDP payload size</dt>
            <dd class="tabular-nums">{{ settings.udpPayloadSize }} bytes</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Rate limiting</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt v-for="limit in settings.qpmPrefixLimitsIPv4" :key="limit.prefix" class="text-gray-500">
              /{{ limit.prefix }}
            </dt>
            <dd v-for="limit in settings.qpmPrefixLimitsIPv4" :key="'v-' + limit.prefix" class="tabular-nums">
              {{ limit.udpLimit.toLocaleString() }} qpm UDP / {{ limit.tcpLimit.toLocaleString() }} qpm TCP
            </dd>
            <dt class="text-gray-500">Sample window</dt>
            <dd>{{ settings.qpmLimitSampleMinutes }} minutes</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Defaults</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultRecordTtl.toLocaleString() }}s</dd>
            <dt class="text-gray-500">NS record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultNsRecordTtl.toLocaleString() }}s</dd>
            <dt class="text-gray-500">SOA record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultSoaRecordTtl.toLocaleString() }}s</dd>
          </dl>
        </div>
      </div>
    </template>
    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
