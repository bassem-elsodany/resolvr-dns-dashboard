<script setup lang="ts">
import { computed, ref } from "vue"
import { fmtInt, pct } from "../../lib/charts"
import { NODE_COLORS } from "../../stores/statsScope"
import {
  displayName,
  formatAgo,
  isHeavyBlocking,
  singleNode,
  type Buckets,
  type ClientRow,
  type NodeBuckets,
  type SampleSummary,
} from "../../lib/clients"
import ClientActivityChart from "./ClientActivityChart.vue"
import NodeCompareChart from "../overview/NodeCompareChart.vue"

const props = defineProps<{
  client: ClientRow
  isNew: boolean
  lease: { mac: string; scope: string; node?: string } | null
  summary: SampleSummary | null
  buckets: Buckets | null
  sampleState: "loading" | "ready" | "error"
  // The cluster's nodes, in order, when the page covers more than one.
  nodes?: string[]
  nodeBuckets?: NodeBuckets | null
}>()

const clustered = computed(() => (props.nodes?.length ?? 0) > 1)

// How this client's queries were shared between the nodes.
const answeredBy = computed(() => {
  const by = props.client.byNode
  if (!clustered.value || !by) return null
  const names = props.nodes!
  const total = names.reduce((n, name) => n + (by[name] ?? 0), 0)
  if (total === 0) return null
  return names.map((name, i) => ({
    name,
    short: name.split(".")[0]!,
    count: by[name] ?? 0,
    pct: Math.round(((by[name] ?? 0) / total) * 100),
    color: NODE_COLORS[i % NODE_COLORS.length]!,
  }))
})
const onlyNode = computed(() => singleNode(props.client))

// "By node" draws one line per node for this client, instead of its total.
const activityMode = ref<"all" | "node">("all")
const nodeSeries = computed(() => {
  const nb = props.nodeBuckets
  if (!nb || !props.nodes) return null
  const n = Object.values(nb.series)[0]?.length ?? 0
  const slice = (nb.end - nb.start) / Math.max(1, n)
  return {
    labels: Array.from({ length: n }, (_, i) => new Date(nb.start + i * slice).toISOString()),
    series: props.nodes.map((name, i) => ({
      name,
      color: NODE_COLORS[i % NODE_COLORS.length]!,
      dashed: i % 2 === 1,
      data: nb.series[name] ?? [],
    })),
  }
})
const nodeColor = (name: string | undefined): string => NODE_COLORS[Math.max(0, props.nodes?.indexOf(name ?? "") ?? 0) % NODE_COLORS.length]!

const emit = defineEmits<{ (e: "open-logs", query: Record<string, string>): void }>()

const PROTO_COLORS = ["rgb(var(--color-chart-blue))", "rgb(var(--color-chart-aqua))", "rgb(var(--color-chart-violet))", "rgb(var(--color-chart-orange))", "rgb(var(--color-chart-gray))", "rgb(var(--color-chart-gray))"]

function maxOf(rows: [string, number][]): number {
  return Math.max(1, ...rows.map((r) => r[1]))
}

function resultClass(type: string): string {
  if (type === "Cached") return "text-chart-aqua"
  if (type === "Recursive") return "text-chart-blue"
  if (type === "Authoritative") return "text-chart-violet"
  if (type.endsWith("Blocked")) return "text-crit"
  return "text-gray-500"
}

const copied = ref(false)
async function copyIp(ip: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(ip)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    // Clipboard refused (non-secure page): the address is on screen to copy.
  }
}
</script>

<template>
  <div id="client-detail">
    <div class="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div class="min-w-0">
        <h3 class="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {{ displayName(client) }}
          <span v-if="isNew" class="rounded border border-chart-violet px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-chart-violet">New</span>
          <span v-if="client.rateLimited" class="rounded border border-crit px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-crit">Rate limited</span>
          <span v-if="isHeavyBlocking(client)" class="rounded border border-warn px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-warn">Heavy blocking</span>
        </h3>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
          <span>IP <b class="font-mono font-medium text-fg">{{ client.ip }}</b></span>
          <span v-if="lease">MAC <b class="font-mono font-medium text-fg">{{ lease.mac }}</b></span>
          <span v-if="lease">Lease <b class="font-medium text-fg">{{ lease.scope }}</b><template v-if="clustered && lease.node"> · from {{ lease.node.split(".")[0] }}</template></span>
          <span>Last query <b class="font-medium text-fg">{{ formatAgo(client.lastSeen) }}</b></span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button id="client-open-logs" type="button" class="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white" @click="emit('open-logs', { client: client.ip })">
          Open in Query Logs
        </button>
        <button id="client-copy" type="button" class="rounded-md border border-border-hover px-3 py-1.5 text-[12.5px]" @click="copyIp(client.ip)">
          {{ copied ? "Copied" : "Copy IP" }}
        </button>
      </div>
    </div>

    <div class="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
      <div class="rounded-lg border border-border bg-background-hover px-3 py-2">
        <div class="text-[11.5px] text-gray-400">Queries</div>
        <div id="detail-queries" class="text-xl font-bold tabular-nums">{{ fmtInt(client.hits) }}</div>
      </div>
      <div class="rounded-lg border border-border bg-background-hover px-3 py-2">
        <div class="text-[11.5px] text-gray-400">Blocked</div>
        <div id="detail-blocked" class="text-xl font-bold tabular-nums">{{ pct(client.blocked, client.hits) }}</div>
      </div>
      <div class="rounded-lg border border-border bg-background-hover px-3 py-2">
        <div class="text-[11.5px] text-gray-400">Cache hit rate</div>
        <div id="detail-cache" class="text-xl font-bold tabular-nums">{{ summary?.cacheShare != null ? `${(summary.cacheShare * 100).toFixed(1)}%` : "–" }}</div>
      </div>
      <div class="rounded-lg border border-border bg-background-hover px-3 py-2">
        <div class="text-[11.5px] text-gray-400">Median upstream</div>
        <div id="detail-rtt" class="text-xl font-bold tabular-nums">{{ summary?.medianRtt != null ? `${Math.round(summary.medianRtt)} ms` : "–" }}</div>
      </div>
    </div>

    <div v-if="answeredBy" id="client-answered-by" class="mb-3.5 rounded-lg border border-border px-3.5 py-3">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
        <span class="font-semibold">Answered by</span>
        <span class="text-gray-500">{{
          onlyNode ? `Only ${onlyNode.split(".")[0]} answers this device: it is not using the other node` : "Both nodes answer this device"
        }}</span>
      </div>
      <div class="mt-2 flex h-3 overflow-hidden rounded-md bg-background-hover" role="img" :aria-label="answeredBy.map((a) => `${a.short} ${a.pct}%`).join(', ')">
        <span v-for="a in answeredBy" :key="a.name" class="block h-full" :style="{ width: `${a.pct}%`, background: a.color }" />
      </div>
      <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span v-for="a in answeredBy" :key="a.name" class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: a.color }" />
          <span class="font-mono">{{ a.short }}</span>
          <span class="tabular-nums text-gray-500">{{ fmtInt(a.count) }} queries ({{ a.pct }}%)</span>
        </span>
      </div>
    </div>

    <p v-if="sampleState === 'loading'" class="py-8 text-center text-sm text-gray-500">Loading this client's queries…</p>
    <p v-else-if="sampleState === 'error' || !summary" class="py-8 text-center text-sm text-gray-500">Could not load this client's queries.</p>
    <p v-else-if="summary.total === 0" class="py-8 text-center text-sm text-gray-500">No logged queries from this client in the selected range.</p>
    <template v-else>
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <p class="text-[12.5px] font-semibold">Activity in the latest {{ fmtInt(summary.total) }} queries</p>
        <div v-if="clustered" role="group" aria-label="Activity view" class="inline-flex gap-0.5 rounded-lg border border-border bg-background-card p-0.5">
          <button id="activity-all" type="button" :aria-pressed="activityMode === 'all'" class="rounded-md px-2.5 py-1 text-xs" :class="activityMode === 'all' ? 'bg-background-hover font-semibold text-fg' : 'text-gray-500'" @click="activityMode = 'all'">All</button>
          <button id="activity-node" type="button" :aria-pressed="activityMode === 'node'" class="rounded-md px-2.5 py-1 text-xs" :class="activityMode === 'node' ? 'bg-background-hover font-semibold text-fg' : 'text-gray-500'" @click="activityMode = 'node'">By node</button>
        </div>
      </div>
      <NodeCompareChart v-if="clustered && activityMode === 'node' && nodeSeries" :labels="nodeSeries.labels" :series="nodeSeries.series" />
      <ClientActivityChart v-else-if="buckets" :buckets="buckets" :label="`Queries over time for ${displayName(client)}`" />
      <p v-else class="py-6 text-center text-sm text-gray-500">Too few queries to draw activity.</p>

      <div class="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
        <div>
          <p class="mb-1.5 text-[12.5px] font-semibold">Top domains</p>
          <button
            v-for="d in summary.domains"
            :key="d[0]"
            type="button"
            class="domain-row block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-background-hover"
            @click="emit('open-logs', { client: client.ip, qname: d[0] })"
          >
            <span class="flex justify-between gap-2"><span class="truncate font-mono">{{ d[0] }}</span><span class="tabular-nums text-gray-400">{{ fmtInt(d[1]) }}</span></span>
            <span class="mt-0.5 block h-[5px] overflow-hidden rounded-full bg-background-hover"><span class="block h-full rounded-full bg-chart-blue" :style="{ width: `${(d[1] / maxOf(summary.domains)) * 100}%` }" /></span>
          </button>
          <p v-if="summary.domains.length === 0" class="px-1 py-3 text-xs text-gray-500">No allowed queries.</p>
        </div>
        <div>
          <p class="mb-1.5 text-[12.5px] font-semibold">Top blocked</p>
          <button
            v-for="d in summary.blockedDomains"
            :key="d[0]"
            type="button"
            class="blocked-row block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-background-hover"
            @click="emit('open-logs', { client: client.ip, qname: d[0] })"
          >
            <span class="flex justify-between gap-2"><span class="truncate font-mono">{{ d[0] }}</span><span class="tabular-nums text-gray-400">{{ fmtInt(d[1]) }}</span></span>
            <span class="mt-0.5 block h-[5px] overflow-hidden rounded-full bg-background-hover"><span class="block h-full rounded-full bg-chart-red" :style="{ width: `${(d[1] / maxOf(summary.blockedDomains)) * 100}%` }" /></span>
          </button>
          <p v-if="summary.blockedDomains.length === 0" class="px-1 py-3 text-xs text-gray-500">Nothing blocked for this client.</p>
        </div>
      </div>

      <div class="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
        <div>
          <p class="mb-1.5 text-[12.5px] font-semibold">Protocols</p>
          <div class="my-1 flex h-3.5 gap-0.5 overflow-hidden rounded">
            <span v-for="(p, i) in summary.protocols" :key="p.label" class="block h-full" :style="{ flex: p.count, background: PROTO_COLORS[i] }" :title="p.label" />
          </div>
          <div class="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-gray-400">
            <span v-for="(p, i) in summary.protocols" :key="p.label" class="protocol-legend inline-flex items-center gap-1.5">
              <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: PROTO_COLORS[i] }" />{{ p.label }} {{ pct(p.count, summary.total, 0) }}
            </span>
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-[12.5px] font-semibold">Record types</p>
          <button
            v-for="t in summary.types"
            :key="t[0]"
            type="button"
            class="type-row block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-background-hover"
            @click="emit('open-logs', { client: client.ip, qtype: t[0] })"
          >
            <span class="flex justify-between gap-2"><span class="font-mono">{{ t[0] }}</span><span class="tabular-nums text-gray-400">{{ fmtInt(t[1]) }}</span></span>
            <span class="mt-0.5 block h-[5px] overflow-hidden rounded-full bg-background-hover"><span class="block h-full rounded-full bg-chart-blue" :style="{ width: `${(t[1] / maxOf(summary.types)) * 100}%` }" /></span>
          </button>
        </div>
      </div>

      <div class="mt-3.5 min-w-0">
          <p class="mb-1.5 text-[12.5px] font-semibold">Latest queries</p>
          <div class="overflow-x-auto">
            <table id="recent-queries" class="w-full border-collapse text-[12.5px]">
              <thead>
                <tr class="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th class="border-b border-border px-2 py-1 font-semibold">When</th>
                  <th class="border-b border-border px-2 py-1 font-semibold">Domain</th>
                  <th class="border-b border-border px-2 py-1 font-semibold">Type</th>
                  <th class="border-b border-border px-2 py-1 font-semibold">Result</th>
                  <th class="border-b border-border px-2 py-1 text-right font-semibold">Time</th>
                  <th v-if="clustered" class="border-b border-border px-2 py-1 font-semibold">Node</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in summary.recent" :key="e.rowNumber + e.timestamp" class="recent-row">
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1 text-gray-400">{{ formatAgo(e.timestamp) }}</td>
                  <td class="border-b border-border/60 px-2 py-1 font-mono text-xs">{{ e.qname }}</td>
                  <td class="border-b border-border/60 px-2 py-1">{{ e.qtype }}</td>
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1"><span class="rounded border border-current px-1.5 text-[11px]" :class="resultClass(e.responseType)">{{ e.responseType }}</span></td>
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1 text-right tabular-nums">{{ typeof e.responseRtt === "number" ? `${Math.round(e.responseRtt)} ms` : "–" }}</td>
                  <td v-if="clustered" class="recent-node whitespace-nowrap border-b border-border/60 px-2 py-1">
                    <span class="inline-flex items-center gap-1.5 font-mono text-xs">
                      <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: nodeColor(e.node) }" />{{ e.node ? e.node.split(".")[0] : "–" }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
      </div>
    </template>
  </div>
</template>
