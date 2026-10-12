<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { CLUSTER, STATS_PANELS, useStatsScopeStore, type PanelId } from "../../stores/statsScope"

// The scope control in a panel's header: which node's data the panel shows,
// or the whole cluster for panels fed by Technitium's statistics. Rendered
// only when the connected server is part of a cluster.
const props = defineProps<{ panel: PanelId; heading?: string }>()

const scope = useStatsScopeStore()
const root = ref<HTMLElement | null>(null)
const open = ref(false)

const isStats = computed(() => (STATS_PANELS as readonly string[]).includes(props.panel))
const isQueries = computed(() => props.panel === "queries")
const comparing = computed(() => isQueries.value && scope.compare)
const current = computed(() => scope.scopeOf(props.panel))
const options = computed(() => scope.options(props.panel))
const label = computed(() => {
  if (comparing.value) return "Compare nodes"
  return current.value === CLUSTER ? "Whole cluster" : current.value
})

// Why a per-node panel cannot show the whole cluster.
const HEADINGS: Partial<Record<PanelId, string>> = {
  responseTime: "Query logs are kept per node",
  flow: "Query logs are kept per node",
  dhcp: "DHCP leases are kept per node",
  zones: "Zones are listed per node",
  cache: "The cache is kept per node",
}
const heading = computed(() => props.heading ?? (isStats.value ? "Show data for" : (HEADINGS[props.panel] ?? "Show data for")))

function pick(id: string): void {
  scope.set(props.panel, id)
  open.value = false
}

function toggleCompare(): void {
  scope.setCompare(!scope.compare)
  open.value = false
}

function onDocPointer(e: Event): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") open.value = false
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer)
  document.addEventListener("keydown", onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer)
  document.removeEventListener("keydown", onKey)
})
</script>

<template>
  <div v-if="scope.available" ref="root" class="relative shrink-0">
    <button
      :id="`scope-chip-${panel}`"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-hover bg-background-card px-2.5 text-xs font-semibold text-fg hover:bg-background-hover"
      @click="open = !open"
    >
      <svg v-if="isStats" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="8" cy="9" r="4" /><circle cx="16" cy="9" r="4" /><circle cx="12" cy="16" r="4" />
      </svg>
      <svg v-else viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
      <span class="max-w-[11rem] truncate">{{ label }}</span>
      <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-9 z-30 w-72 rounded-lg border border-border-hover bg-background-card p-1.5 shadow-lg"
    >
      <div class="px-2.5 pb-1 pt-1.5 text-[11.5px] font-semibold text-gray-500">{{ heading }}</div>
      <button
        v-for="o in options"
        :id="`scope-option-${panel}-${o.id}`"
        :key="o.id"
        type="button"
        role="menuitemradio"
        :aria-checked="o.id === current && !comparing"
        :disabled="o.disabled"
        class="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
        :class="o.id === current && !comparing ? 'bg-accent/10' : 'hover:bg-background-hover'"
        @click="pick(o.id)"
      >
        <span
          class="mt-0.5 box-border h-3.5 w-3.5 shrink-0 rounded-full bg-background-card"
          :class="o.id === current && !comparing ? 'border-4 border-accent' : 'border-[1.5px] border-gray-500'"
        />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-[12.5px] font-semibold">{{ o.title }}</span>
          <span class="text-[11.5px] text-gray-500">{{ o.sub }}</span>
        </span>
      </button>

      <template v-if="isQueries">
        <div class="mx-1 my-1.5 h-px bg-border" />
        <button
          id="scope-compare"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="scope.compare"
          class="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left"
          :class="scope.compare ? 'bg-accent/10' : 'hover:bg-background-hover'"
          @click="toggleCompare"
        >
          <span
            class="mt-0.5 box-border h-3.5 w-3.5 shrink-0 rounded border-[1.5px] border-gray-500"
            :class="scope.compare ? 'bg-accent' : 'bg-background-card'"
          />
          <span class="flex flex-col">
            <span class="text-[12.5px] font-semibold">Compare nodes</span>
            <span class="text-[11.5px] text-gray-500">One line per node, same axis</span>
          </span>
        </button>
      </template>
    </div>
  </div>
</template>
