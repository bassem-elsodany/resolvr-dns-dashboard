<script setup lang="ts">
import { ref } from "vue"
import { fmtInt, pct } from "../../lib/charts"
import {
  displayName,
  formatAgo,
  isHeavyBlocking,
  type Buckets,
  type ClientRow,
  type SampleSummary,
} from "../../lib/clients"
import ClientActivityChart from "./ClientActivityChart.vue"

defineProps<{
  client: ClientRow
  isNew: boolean
  lease: { mac: string; scope: string } | null
  summary: SampleSummary | null
  buckets: Buckets | null
  sampleState: "loading" | "ready" | "error"
}>()

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
          <span v-if="lease">Lease <b class="font-medium text-fg">{{ lease.scope }}</b></span>
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

    <p v-if="sampleState === 'loading'" class="py-8 text-center text-sm text-gray-500">Loading this client's queries…</p>
    <p v-else-if="sampleState === 'error' || !summary" class="py-8 text-center text-sm text-gray-500">Could not load this client's queries.</p>
    <p v-else-if="summary.total === 0" class="py-8 text-center text-sm text-gray-500">No logged queries from this client in the selected range.</p>
    <template v-else>
      <p class="mb-1.5 text-[12.5px] font-semibold">Activity in the latest {{ fmtInt(summary.total) }} queries</p>
      <ClientActivityChart v-if="buckets" :buckets="buckets" :label="`Queries over time for ${displayName(client)}`" />
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
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in summary.recent" :key="e.rowNumber + e.timestamp" class="recent-row">
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1 text-gray-400">{{ formatAgo(e.timestamp) }}</td>
                  <td class="border-b border-border/60 px-2 py-1 font-mono text-xs">{{ e.qname }}</td>
                  <td class="border-b border-border/60 px-2 py-1">{{ e.qtype }}</td>
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1"><span class="rounded border border-current px-1.5 text-[11px]" :class="resultClass(e.responseType)">{{ e.responseType }}</span></td>
                  <td class="whitespace-nowrap border-b border-border/60 px-2 py-1 text-right tabular-nums">{{ typeof e.responseRtt === "number" ? `${Math.round(e.responseRtt)} ms` : "–" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
      </div>
    </template>
  </div>
</template>
