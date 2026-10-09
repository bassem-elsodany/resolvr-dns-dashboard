<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { forceUpdateBlockLists, AppApiError } from "../../api/app"
import { fmtInt } from "../../lib/charts"
import { formatAgo } from "../../lib/clients"
import { changeSincePrevious, formatIn, freshness, readHistory, recordReading, type Reading } from "../../lib/blockLists"
import { useChartTip } from "../../composables/useChartTip"
import ChartTip from "../charts/ChartTip.vue"

const props = defineProps<{
  enableBlocking: boolean | null
  blockingType: string | null
  nextUpdatedOn?: string
  intervalHours?: number
  // Domains held by the block lists, from the server's statistics.
  total: number | null
  isAdmin: boolean
  hasUnsavedFeeds: boolean
  // Reads the server's current next-update time and total, for watching an update finish.
  fetchStatus: () => Promise<{ next?: string; total: number | null }>
}>()

const emit = defineEmits<{ (e: "updated"): void }>()

const POLL_MS = 3000
const MAX_POLLS = 30

// ---------- freshness ----------

const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(tick))

const fresh = computed(() => freshness(props.nextUpdatedOn, props.intervalHours, now.value))

// ---------- history ----------

const history = ref<Reading[]>(readHistory())
watch(
  () => props.total,
  (t) => {
    if (t !== null) history.value = recordReading(t)
  },
  { immediate: true },
)
const change = computed(() => changeSincePrevious(history.value))

function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmtInt(Math.abs(n))}`
}

const { tip, show, hide } = useChartTip()
const W = 320
const H = 90
const PAD_X = 6
const PAD_TOP = 8
const PAD_BOTTOM = 14
const chart = computed(() => {
  const h = history.value
  if (h.length < 2) return null
  const totals = h.map((p) => p.total)
  const mn = Math.min(...totals)
  const mx = Math.max(...totals)
  const pad = Math.max(1, (mx - mn) * 0.15)
  const x = (i: number) => PAD_X + (i / (h.length - 1)) * (W - 2 * PAD_X)
  const y = (v: number) => PAD_TOP + (1 - (v - (mn - pad)) / (mx + pad - (mn - pad))) * (H - PAD_TOP - PAD_BOTTOM)
  const line = h.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join("")
  return { x, y, line, area: `${line}L${x(h.length - 1)},${H - PAD_BOTTOM}L${x(0)},${H - PAD_BOTTOM}Z` }
})
const hoverIndex = ref<number | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

function stamp(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
}

function onMove(e: PointerEvent): void {
  const rect = svgEl.value!.getBoundingClientRect()
  const h = history.value
  if (rect.width === 0 || h.length < 2) return
  const vx = ((e.clientX - rect.left) / rect.width) * W
  const i = Math.max(0, Math.min(h.length - 1, Math.round(((vx - PAD_X) / (W - 2 * PAD_X)) * (h.length - 1))))
  hoverIndex.value = i
  const prev = h[i - 1]
  show(e, stamp(h[i]!.t), [
    { label: "Domains", value: fmtInt(h[i]!.total) },
    ...(prev ? [{ label: "Change", value: signed(h[i]!.total - prev.total) }] : []),
  ])
}

function onLeave(): void {
  hoverIndex.value = null
  hide()
}

const recent = computed(() =>
  history.value
    .map((p, i, all) => ({ ...p, delta: i > 0 ? p.total - all[i - 1]!.total : null }))
    .slice(-5)
    .reverse(),
)

// ---------- Update now ----------

const updating = ref(false)
const startedAt = ref(0)
const elapsed = ref(0)
const error = ref<string | null>(null)
const result = ref<{ from: number | null; to: number | null } | null>(null)
const stillRunning = ref(false)
let elapsedTimer: ReturnType<typeof setInterval> | null = null

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// The server starts the update in the background and gives no progress, so
// this watches its next-update time: that moves once the update finishes.
async function startUpdate(): Promise<void> {
  if (updating.value) return
  updating.value = true
  error.value = null
  result.value = null
  stillRunning.value = false
  startedAt.value = Date.now()
  elapsed.value = 0
  elapsedTimer = setInterval(() => (elapsed.value = Math.round((Date.now() - startedAt.value) / 1000)), 1000)
  const before = { next: props.nextUpdatedOn, total: props.total }
  try {
    await forceUpdateBlockLists()
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS)
      const s = await props.fetchStatus()
      if (s.next && s.next !== before.next) {
        if (s.total !== null) history.value = recordReading(s.total, Date.now(), true)
        result.value = { from: before.total, to: s.total }
        emit("updated")
        return
      }
    }
    stillRunning.value = true
    emit("updated")
  } catch (err) {
    error.value = err instanceof AppApiError ? err.message : "Could not start the update."
  } finally {
    updating.value = false
    if (elapsedTimer) clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

async function checkAgain(): Promise<void> {
  const before = props.nextUpdatedOn
  const s = await props.fetchStatus()
  emit("updated")
  if (s.next && s.next !== before) {
    stillRunning.value = false
    if (s.total !== null) history.value = recordReading(s.total, Date.now(), true)
  }
}

defineExpose({ startUpdate })
</script>

<template>
  <section class="grid grid-cols-1 gap-5 rounded-lg border border-border bg-background-card p-4 lg:grid-cols-[1.2fr_1fr]" aria-label="Block list status">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2.5">
        <h2 class="text-sm font-semibold">Block lists</h2>
        <span
          v-if="enableBlocking !== null"
          id="blocking-pill"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="enableBlocking ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'"
        >
          <span class="inline-block h-[7px] w-[7px] rounded-full bg-current" />{{ enableBlocking ? "Blocking on" : "Blocking off" }}
        </span>
        <span v-if="blockingType" class="text-xs text-gray-500">Blocked names answer {{ blockingType }}</span>
      </div>

      <div class="my-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <div>
          <div class="text-xs text-gray-400">Domains in the lists</div>
          <div id="status-total" class="text-2xl font-bold leading-tight tabular-nums">{{ total !== null ? fmtInt(total) : "–" }}</div>
          <div v-if="change !== null" id="status-change" class="text-xs text-gray-500">{{ signed(change) }} since the previous refresh</div>
        </div>
        <div>
          <div class="text-xs text-gray-400">Last updated</div>
          <div id="status-last" class="text-2xl font-bold leading-tight">{{ fresh.lastUpdated ? formatAgo(new Date(fresh.lastUpdated).toISOString(), now) : "–" }}</div>
          <div v-if="fresh.lastUpdated" class="text-xs text-gray-500">{{ stamp(fresh.lastUpdated) }}</div>
        </div>
        <div>
          <div class="text-xs text-gray-400">Next update</div>
          <div id="status-next" class="text-2xl font-bold leading-tight" :class="fresh.overdue ? 'text-warn' : ''">
            {{ fresh.next ? (fresh.overdue ? "Overdue" : formatIn(fresh.next - now)) : "–" }}
          </div>
          <div v-if="intervalHours" class="text-xs text-gray-500">Every {{ intervalHours }} hours</div>
        </div>
      </div>

      <div v-if="isAdmin" class="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <button
          id="update-now"
          type="button"
          :disabled="updating"
          class="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          @click="startUpdate"
        >
          {{ updating ? "Updating…" : "Update now" }}
        </button>
        <span v-if="hasUnsavedFeeds && !updating" id="unsaved-hint" class="text-xs text-gray-500">
          You have unsaved feed changes. Use “Save and update now” below so they are included.
        </span>
        <span v-else-if="!updating" class="text-xs text-gray-500">Downloads every feed again and merges them.</span>
      </div>
      <p v-else class="text-xs text-gray-500">Only admins can start an update.</p>

      <div v-if="updating" id="update-progress" class="mt-2.5">
        <div class="h-1.5 overflow-hidden rounded-full bg-background-hover"><div class="h-full w-1/3 animate-pulse rounded-full bg-accent" /></div>
        <p class="mt-1.5 text-xs text-gray-500">The server is downloading and merging the feeds ({{ elapsed }} s). This can take a minute.</p>
      </div>
      <p v-if="error" id="update-error" class="mt-2.5 text-sm text-crit">{{ error }}</p>
      <p v-if="result" id="update-result" class="mt-2.5 rounded-lg bg-ok/15 px-3 py-2 text-[13px] text-ok">
        <b>Updated.</b>{{ " " }}
        <template v-if="result.from !== null && result.to !== null">
          {{ fmtInt(result.from) }} → {{ fmtInt(result.to) }} domains ({{ signed(result.to - result.from) }}).
        </template>
      </p>
      <p v-if="stillRunning" id="update-still" class="mt-2.5 rounded-lg bg-warn/15 px-3 py-2 text-[13px] text-warn">
        The server has not finished yet. Large lists can take several minutes.
        <button type="button" class="font-semibold underline" @click="checkAgain">Check again</button>
      </p>
    </div>

    <div class="min-w-0">
      <h2 class="text-sm font-semibold">Domains in the lists, over time</h2>
      <p class="mb-1 mt-0.5 text-xs text-gray-500">
        One reading per refresh, kept in this browser. A change shows what an update added or removed overall.
      </p>
      <svg
        v-if="chart"
        ref="svgEl"
        :viewBox="`0 0 ${W} ${H}`"
        class="block h-auto w-full cursor-crosshair"
        role="img"
        aria-label="Domains in block lists after each refresh"
        @pointermove="onMove"
        @pointerleave="onLeave"
      >
        <line :x1="PAD_X" :x2="W - PAD_X" :y1="H - PAD_BOTTOM" :y2="H - PAD_BOTTOM" stroke="rgb(var(--color-border-hover))" />
        <path :d="chart.area" fill="rgb(var(--color-chart-blue))" fill-opacity="0.12" />
        <path :d="chart.line" fill="none" stroke="rgb(var(--color-chart-blue))" stroke-width="2" stroke-linejoin="round" />
        <circle
          :cx="chart.x(hoverIndex ?? history.length - 1)"
          :cy="chart.y(history[hoverIndex ?? history.length - 1]!.total)"
          r="4.5"
          fill="rgb(var(--color-chart-blue))"
          stroke="rgb(var(--color-bg-card))"
          stroke-width="2"
        />
        <text :x="PAD_X" :y="H - 2" font-size="10" style="fill: rgb(var(--color-gray-500))">{{ stamp(history[0]!.t) }}</text>
        <text :x="W - PAD_X" :y="H - 2" font-size="10" text-anchor="end" style="fill: rgb(var(--color-gray-500))">now</text>
      </svg>
      <p v-else id="history-empty" class="py-5 text-xs text-gray-500">The history starts with your next refresh.</p>
      <table v-if="recent.length > 1" id="history-table" class="mt-1.5 w-full border-collapse text-[12.5px]">
        <thead>
          <tr class="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th class="border-b border-border px-1.5 py-1 font-semibold">Refresh</th>
            <th class="border-b border-border px-1.5 py-1 text-right font-semibold">Domains</th>
            <th class="border-b border-border px-1.5 py-1 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in recent" :key="r.t" class="history-row tabular-nums">
            <td class="border-b border-border/60 px-1.5 py-1">{{ formatAgo(new Date(r.t).toISOString(), now) }}</td>
            <td class="border-b border-border/60 px-1.5 py-1 text-right">{{ fmtInt(r.total) }}</td>
            <td class="border-b border-border/60 px-1.5 py-1 text-right">{{ r.delta === null ? "–" : signed(r.delta) }}</td>
          </tr>
        </tbody>
      </table>
      <ChartTip :tip="tip" />
    </div>
  </section>
</template>
