<script setup lang="ts">
import { computed } from "vue"
import { fmtInt, pct } from "../../lib/charts"
import {
  blockedShare,
  displayName,
  formatAgo,
  isHeavyBlocking,
  type ClientFilter,
  type ClientRow,
  type ClientSort,
} from "../../lib/clients"

const props = defineProps<{
  rows: ClientRow[]
  total: number
  selectedIp: string | null
  newIps: ReadonlySet<string>
  filter: ClientFilter
  sort: ClientSort
  search: string
  counts: Record<ClientFilter, number>
}>()

const emit = defineEmits<{
  (e: "select", ip: string): void
  (e: "update:filter", v: ClientFilter): void
  (e: "update:sort", v: ClientSort): void
  (e: "update:search", v: string): void
}>()

const FILTERS: { id: ClientFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "heavy", label: "Heavy blocking" },
  { id: "limited", label: "Rate limited" },
  { id: "new", label: "New" },
  { id: "quiet", label: "Quiet" },
]
// "Needs a look" is reached from its summary tile, so it only appears as a
// chip while it is the active filter.
const chips = computed(() => (props.filter === "attention" ? [...FILTERS, { id: "attention" as ClientFilter, label: "Needs a look" }] : FILTERS))

function onKey(e: KeyboardEvent): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
  e.preventDefault()
  const i = props.rows.findIndex((r) => r.ip === props.selectedIp)
  const next = props.rows[Math.max(0, Math.min(props.rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]
  if (next) emit("select", next.ip)
}
</script>

<template>
  <div>
    <div class="mb-2 flex flex-col gap-2">
      <input
        id="client-search"
        type="search"
        placeholder="Search name or IP"
        aria-label="Search clients"
        autocomplete="off"
        class="w-full rounded-lg border border-border-hover bg-background-card px-2.5 py-1.5 text-[13px]"
        :value="search"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter clients">
        <button
          v-for="f in chips"
          :key="f.id"
          type="button"
          :data-filter="f.id"
          :aria-pressed="filter === f.id"
          class="client-chip rounded-full border px-2.5 py-0.5 text-xs"
          :class="filter === f.id ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover'"
          @click="emit('update:filter', f.id)"
        >
          {{ f.label }}<span class="ml-1 tabular-nums text-gray-500">{{ counts[f.id] }}</span>
        </button>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <label for="client-sort">Sort by</label>
        <select
          id="client-sort"
          class="rounded-md border border-border-hover bg-background-card px-1.5 py-0.5 text-fg"
          :value="sort"
          @change="emit('update:sort', ($event.target as HTMLSelectElement).value as ClientSort)"
        >
          <option value="queries">Most queries</option>
          <option value="blocked">Highest block rate</option>
          <option value="name">Name</option>
          <option value="recent">Most recently active</option>
        </select>
        <span id="client-count" class="ml-auto tabular-nums">{{ rows.length }} of {{ total }}</span>
      </div>
    </div>

    <p v-if="rows.length === 0" class="px-2 py-7 text-center text-sm text-gray-500">No clients match. Clear the search or pick another filter.</p>
    <div v-else id="client-list" role="listbox" aria-label="Clients" tabindex="0" class="flex max-h-[640px] flex-col gap-0.5 overflow-y-auto" @keydown="onKey">
      <button
        v-for="c in rows"
        :key="c.ip"
        type="button"
        role="option"
        :aria-selected="c.ip === selectedIp"
        :data-ip="c.ip"
        :title="`Last seen ${formatAgo(c.lastSeen)}`"
        class="client-row grid w-full grid-cols-[30px_minmax(0,1fr)_88px] items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left"
        :class="c.ip === selectedIp ? 'border-accent/40 bg-accent/15' : 'border-transparent hover:bg-background-hover'"
        @click="emit('select', c.ip)"
      >
        <span
          class="grid h-[30px] w-[30px] place-items-center rounded-full border text-xs font-bold uppercase"
          :class="c.ip === selectedIp ? 'border-accent bg-accent text-white' : 'border-border bg-background-hover text-gray-400'"
          aria-hidden="true"
          >{{ displayName(c).charAt(0) }}</span
        >
        <span class="min-w-0">
          <span class="block truncate text-[13px] font-semibold">{{ displayName(c) }}</span>
          <span class="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-gray-500">
            {{ c.ip }}
            <span v-if="newIps.has(c.ip)" class="badge-new rounded border border-chart-violet px-1 font-sans text-[10px] font-bold uppercase leading-[15px] tracking-wide text-chart-violet">New</span>
            <span v-if="c.rateLimited" class="badge-limited rounded border border-crit px-1 font-sans text-[10px] font-bold uppercase leading-[15px] tracking-wide text-crit">Rate limited</span>
            <span v-if="isHeavyBlocking(c)" class="badge-heavy rounded border border-warn px-1 font-sans text-[10px] font-bold uppercase leading-[15px] tracking-wide text-warn">Heavy blocking</span>
          </span>
        </span>
        <span class="text-right tabular-nums">
          <span class="block text-[13px] font-semibold">{{ fmtInt(c.hits) }}</span>
          <span class="block text-[11px] text-gray-500">{{ pct(c.blocked, c.hits, 0) }} blocked</span>
          <span class="mt-0.5 flex h-1 overflow-hidden rounded-full bg-chart-blue/30" aria-hidden="true">
            <span class="block h-full bg-chart-red" :style="{ width: `${Math.min(100, blockedShare(c) * 100)}%` }" />
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
