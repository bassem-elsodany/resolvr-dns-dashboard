<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { fmtInt } from "../../lib/charts"
import ChartPanel from "../charts/ChartPanel.vue"

const props = defineProps<{ entries: number }>()

// Technitium only reports the current cache size, so the trend is built
// from readings this browser takes while the dashboard is open. They are
// kept for 24 hours, at most one a minute.
const KEY = "resolvr.cacheSamples"
const DAY_MS = 86400_000
const MIN_GAP_MS = 60_000

interface Sample {
  t: number
  v: number
}

function readSamples(): Sample[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Sample[]
    return Array.isArray(raw) ? raw.filter((s) => typeof s.t === "number" && typeof s.v === "number") : []
  } catch {
    return []
  }
}

const samples = ref<Sample[]>(readSamples())

watch(
  () => props.entries,
  (v) => {
    const now = Date.now()
    const kept = samples.value.filter((s) => now - s.t < DAY_MS)
    const last = kept[kept.length - 1]
    if (!last || now - last.t >= MIN_GAP_MS) kept.push({ t: now, v })
    samples.value = kept
    try {
      localStorage.setItem(KEY, JSON.stringify(kept))
    } catch {
      // Storage blocked: the trend just restarts on the next visit.
    }
  },
  { immediate: true },
)

const W = 200
const H = 60
const path = computed(() => {
  const s = samples.value
  if (s.length < 2) return null
  const vs = s.map((x) => x.v)
  const mn = Math.min(...vs)
  const mx = Math.max(...vs)
  const t0 = s[0]!.t
  const span = Math.max(1, s[s.length - 1]!.t - t0)
  const x = (t: number) => ((t - t0) / span) * W
  const y = (v: number) => H - 8 - ((v - mn) / Math.max(1, mx - mn)) * (H - 16)
  const line = s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const last = s[s.length - 1]!
  return { line, area: `${line} L${W},${H} L0,${H} Z`, endX: x(last.t), endY: y(last.v) }
})
</script>

<template>
  <ChartPanel title="Cache size" hint="Entries in the resolver cache, sampled while this page is open.">
    <div class="text-[26px] font-bold leading-tight tracking-tight tabular-nums" id="cache-entries">{{ fmtInt(entries) }}</div>
    <div class="text-xs text-gray-500">entries now</div>
    <svg v-if="path" :viewBox="`0 0 ${W} ${H}`" class="mt-1 block h-[60px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Cache size trend">
      <path :d="path.area" fill="rgb(var(--color-chart-aqua))" fill-opacity="0.12" />
      <path :d="path.line" fill="none" stroke="rgb(var(--color-chart-aqua))" stroke-width="2" vector-effect="non-scaling-stroke" />
      <circle :cx="path.endX" :cy="path.endY" r="3.5" fill="rgb(var(--color-chart-aqua))" stroke="rgb(var(--color-bg-card))" stroke-width="2" />
    </svg>
    <p v-else id="cache-trend-hint" class="mt-2 text-[11.5px] text-gray-500">The trend appears as the dashboard keeps taking readings.</p>
  </ChartPanel>
</template>
