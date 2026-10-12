<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { getClusterState, getDashboardStats, type ClusterNode } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import { fmtInt } from "../../lib/charts"
import ChartPanel from "../charts/ChartPanel.vue"

// How queries were shared between the nodes of a Technitium cluster in the
// selected range, with each node's role and whether it is reachable. Read
// from the connected node, so no extra connection is needed.
const connection = useConnectionStore()
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()

interface Row {
  node: ClusterNode
  queries: number | null
  color: string
}

const COLORS = ["rgb(var(--color-chart-blue))", "rgb(var(--color-chart-orange))", "rgb(var(--color-chart-violet))", "rgb(var(--color-chart-aqua))"]

const rows = ref<Row[]>([])
const state = ref<"loading" | "ready" | "error">("loading")

async function load(): Promise<void> {
  try {
    const cluster = await getClusterState(connection.credentials)
    const nodes = cluster.response.clusterNodes ?? []
    rows.value = await Promise.all(
      nodes.map(async (node, i): Promise<Row> => {
        const color = COLORS[i % COLORS.length]!
        if (node.state === "Unreachable") return { node, queries: null, color }
        try {
          // The connected node answers for itself; the others are named.
          const res = await getDashboardStats(timeRange.selected, connection.credentials, {
            utc: true,
            node: node.name === connection.serverDomain ? undefined : node.name,
          })
          return { node, queries: res.response.stats.totalQueries, color }
        } catch {
          return { node, queries: null, color }
        }
      }),
    )
    state.value = "ready"
  } catch {
    state.value = "error"
  }
}

const total = computed(() => rows.value.reduce((n, r) => n + (r.queries ?? 0), 0))
const partial = computed(() => rows.value.some((r) => r.queries === null))
const share = (r: Row): string => (r.queries === null || total.value === 0 ? "" : `${Math.round((r.queries / total.value) * 100)}%`)
const isSelf = (r: Row): boolean => r.node.name === connection.serverDomain

onMounted(() => void load())
watch(() => timeRange.selected, () => void load())
watch(() => refresh.tick, () => void load())
</script>

<template>
  <ChartPanel title="Cluster nodes" hint="How queries were shared between the nodes in the selected range. Read from the connected node.">
    <p v-if="state === 'loading'" class="py-6 text-center text-sm text-gray-500">Loading…</p>
    <p v-else-if="state === 'error'" class="py-6 text-center text-sm text-gray-500">Could not read the cluster state.</p>
    <template v-else>
      <div
        class="flex h-2.5 overflow-hidden rounded-md bg-background-hover"
        role="img"
        :aria-label="rows.map((r) => `${r.node.name} ${share(r)}`).join(', ')"
      >
        <span
          v-for="r in rows"
          :key="r.node.name"
          :style="{ width: total ? `${((r.queries ?? 0) / total) * 100}%` : '0%', background: r.color }"
        />
      </div>
      <p v-if="partial" class="mt-2 text-[11.5px] font-semibold text-warn">
        A node could not be read, so whole-cluster totals are partial.
      </p>
      <ul class="mt-2">
        <li
          v-for="r in rows"
          :key="r.node.name"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-2.5 first:border-t-0"
        >
          <span class="h-2.5 w-2.5 rounded-sm" :style="{ background: r.color }" />
          <span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">{{ r.node.name }}</span>
          <span class="rounded-full bg-background-hover px-2 py-0.5 text-[11.5px] font-semibold">{{ r.node.type }}</span>
          <span class="inline-flex items-center gap-1.5 text-xs" :class="r.node.state === 'Unreachable' ? 'font-semibold text-crit' : 'text-gray-500'">
            <span class="h-2 w-2 rounded-full" :class="r.node.state === 'Unreachable' ? 'bg-crit' : 'bg-ok'" />
            {{ r.node.state === "Unreachable" ? "Unreachable" : "Connected" }}
          </span>
          <span class="w-24 text-right font-mono text-[12.5px] tabular-nums">{{ r.queries === null ? "no data" : fmtInt(r.queries) }}</span>
          <span class="w-10 text-right text-[12.5px] font-semibold tabular-nums">{{ share(r) }}</span>
          <span v-if="isSelf(r)" class="text-[11.5px] font-semibold text-accent">Resolvr connects here</span>
        </li>
      </ul>
    </template>
  </ChartPanel>
</template>
