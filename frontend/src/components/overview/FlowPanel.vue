<script setup lang="ts">
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import { fmtInt, labelYs, pct, stackNodes, type Flows } from "../../lib/charts"
import { useChartTip } from "../../composables/useChartTip"
import ChartPanel from "../charts/ChartPanel.vue"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{ flows: Flows | null; state: "loading" | "ready" | "missing" | "error" }>()
const router = useRouter()
const { tip, show, hide } = useChartTip()

const PATH_COLOR: Record<string, string> = {
  Cached: "rgb(var(--color-chart-aqua))",
  Recursive: "rgb(var(--color-chart-blue))",
  Authoritative: "rgb(var(--color-chart-violet))",
  Blocked: "rgb(var(--color-chart-red))",
  Other: "rgb(var(--color-chart-gray))",
}
const OUT_COLOR: Record<string, string> = {
  "No error": "rgb(var(--color-chart-blue))",
  NXDomain: "rgb(var(--color-chart-orange))",
  "Server failure": "rgb(var(--color-chart-violet))",
  "Blocked reply": "rgb(var(--color-chart-red))",
  Refused: "rgb(var(--color-chart-gray))",
  Other: "rgb(var(--color-chart-gray))",
}
// What clicking an outcome filters Query Logs by.
const OUT_FILTER: Record<string, Record<string, string>> = {
  "No error": { rcode: "NoError" },
  NXDomain: { rcode: "NxDomain" },
  "Server failure": { rcode: "ServerFailure" },
  Refused: { rcode: "Refused" },
  "Blocked reply": { responseType: "Blocked" },
}

const W = 760
const H = 320
const NW = 12
const GAP = 10
const LX = 96
const MX = 330
const RX = 560

const layout = computed(() => {
  const f = props.flows
  if (!f || f.total === 0) return null
  const maxCount = Math.max(f.paths.length, f.outcomes.length)
  const k = (H - 16 - GAP * (maxCount - 1)) / f.total
  const paths = stackNodes(f.paths.map((p) => p.value), MX, 8, k, GAP)
  const outs = stackNodes(f.outcomes.map((o) => o.value), RX, 8, k, GAP)
  const query = { x: LX, y: 8, h: Math.max(3, f.total * k) }

  type Link = { key: string; d: string; width: number; color: string; title: string; count: number }
  const links: Link[] = []
  // Query -> path
  let qOff = 0
  const m1 = (LX + NW + MX) / 2
  f.paths.forEach((p, i) => {
    const th = Math.max(1, p.value * k)
    const sy = query.y + qOff + th / 2
    const ty = paths[i]!.y + th / 2
    qOff += th
    links.push({
      key: `q-${p.name}`,
      d: `M${LX + NW},${sy}C${m1},${sy} ${m1},${ty} ${MX},${ty}`,
      width: th,
      color: PATH_COLOR[p.name]!,
      title: `Queries → ${p.name}`,
      count: p.value,
    })
  })
  // Path -> outcome
  const pOff = f.paths.map(() => 0)
  const oOff = f.outcomes.map(() => 0)
  const m2 = (MX + NW + RX) / 2
  for (const [pi, oi, n] of f.links) {
    const th = Math.max(1, n * k)
    const sy = paths[pi]!.y + pOff[pi]! + th / 2
    const ty = outs[oi]!.y + oOff[oi]! + th / 2
    pOff[pi]! += th
    oOff[oi]! += th
    links.push({
      key: `${pi}-${oi}`,
      d: `M${MX + NW},${sy}C${m2},${sy} ${m2},${ty} ${RX},${ty}`,
      width: th,
      color: PATH_COLOR[f.paths[pi]!.name]!,
      title: `${f.paths[pi]!.name} → ${f.outcomes[oi]!.name}`,
      count: n,
    })
  }
  return { query, paths, outs, links, total: f.total, pathLabelY: labelYs(paths), outLabelY: labelYs(outs) }
})

const hot = ref<string | null>(null)

function onPathClick(name: string): void {
  if (name !== "Other") void router.push({ path: "/logs", query: { responseType: name } })
}
function onOutClick(name: string): void {
  const q = OUT_FILTER[name]
  if (q) void router.push({ path: "/logs", query: q })
}
</script>

<template>
  <ChartPanel
    title="How a query is resolved"
    :hint="flows && flows.total ? `From the latest ${fmtInt(flows.total)} logged queries. Hover a flow, click a node to filter.` : 'From the latest logged queries.'"
  >
    <p v-if="state === 'loading'" class="py-8 text-center text-sm text-gray-500">Loading…</p>
    <p v-else-if="state === 'missing'" class="py-8 text-center text-sm text-gray-500">
      Needs a query-logging app installed on the Technitium server.
    </p>
    <p v-else-if="state === 'error'" class="py-8 text-center text-sm text-gray-500">Could not load the query log.</p>
    <p v-else-if="!layout" class="py-8 text-center text-sm text-gray-500">No logged queries yet.</p>
    <div v-else class="overflow-x-auto">
      <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto min-w-[560px] w-full" role="img" aria-label="Flow from queries to resolution path to outcome">
        <path
          v-for="l in layout.links"
          :key="l.key"
          class="flow-link"
          :d="l.d"
          fill="none"
          :stroke="l.color"
          :stroke-width="l.width"
          :stroke-opacity="hot === null ? 0.35 : hot === l.key ? 0.75 : 0.12"
          @pointerenter="hot = l.key"
          @pointermove="show($event, l.title, [{ label: 'queries', value: `${fmtInt(l.count)} · ${pct(l.count, layout.total)}` }])"
          @pointerleave="((hot = null), hide())"
        />
        <rect :x="layout.query.x" :y="layout.query.y" :width="NW" :height="layout.query.h" rx="3" style="fill: rgb(var(--color-gray-400))" />
        <text :x="LX - 8" :y="layout.query.y + layout.query.h / 2 - 4" font-size="12" font-weight="700" text-anchor="end" style="fill: rgb(var(--color-fg))">Queries</text>
        <text :x="LX - 8" :y="layout.query.y + layout.query.h / 2 + 12" font-size="11.5" text-anchor="end" style="fill: rgb(var(--color-gray-500))">{{ fmtInt(layout.total) }}</text>

        <g v-for="(n, i) in layout.paths" :key="flows!.paths[i]!.name">
          <rect
            class="flow-node"
            :x="n.x"
            :y="n.y"
            :width="NW"
            :height="n.h"
            rx="2"
            :fill="PATH_COLOR[flows!.paths[i]!.name]"
            :style="{ cursor: flows!.paths[i]!.name === 'Other' ? 'default' : 'pointer' }"
            @click="onPathClick(flows!.paths[i]!.name)"
          />
          <text
            :x="n.x + NW + 8"
            :y="layout.pathLabelY[i]"
            font-size="11.5"
            style="fill: rgb(var(--color-fg)); paint-order: stroke; stroke: rgb(var(--color-bg-card)); stroke-width: 3px"
          >
            {{ flows!.paths[i]!.name }} · {{ fmtInt(n.value) }}
          </text>
        </g>
        <g v-for="(n, i) in layout.outs" :key="flows!.outcomes[i]!.name">
          <rect
            class="flow-node"
            :x="n.x"
            :y="n.y"
            :width="NW"
            :height="n.h"
            rx="2"
            :fill="OUT_COLOR[flows!.outcomes[i]!.name]"
            :style="{ cursor: OUT_FILTER[flows!.outcomes[i]!.name] ? 'pointer' : 'default' }"
            @click="onOutClick(flows!.outcomes[i]!.name)"
          />
          <text :x="n.x + NW + 8" :y="layout.outLabelY[i]" font-size="11.5" style="fill: rgb(var(--color-fg))">
            {{ flows!.outcomes[i]!.name }} · {{ fmtInt(n.value) }}
          </text>
        </g>
      </svg>
      <ChartTip :tip="tip" />
    </div>
  </ChartPanel>
</template>
