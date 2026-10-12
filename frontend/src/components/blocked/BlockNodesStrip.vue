<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import { fmtInt } from "../../lib/charts"
import { formatAgo } from "../../lib/clients"
import { formatIn, freshness } from "../../lib/blockLists"
import { NODE_COLORS } from "../../stores/statsScope"

// Each cluster node downloads the block lists itself, so each has its own
// count, last update and next update. This shows them side by side.
export interface BlockNodeStatus {
  name: string
  total: number | null
  nextUpdatedOn?: string
  intervalHours?: number
  enableBlocking: boolean | null
  readable: boolean
}

const props = defineProps<{
  nodes: BlockNodeStatus[]
  allNames: string[]
  isAdmin: boolean
  // "both" or a node name: where Update now is sent.
  updateOn: string
}>()
const emit = defineEmits<{ (e: "update:updateOn", v: string): void }>()

const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(tick))

const rows = computed(() =>
  props.nodes.map((n) => {
    const f = freshness(n.nextUpdatedOn, n.intervalHours, now.value)
    return {
      ...n,
      short: n.name.split(".")[0]!,
      color: NODE_COLORS[Math.max(0, props.allNames.indexOf(n.name)) % NODE_COLORS.length]!,
      last: f.lastUpdated ? formatAgo(new Date(f.lastUpdated).toISOString(), now.value) : "–",
      next: f.next ? (f.overdue ? "Overdue" : formatIn(f.next - now.value)) : "–",
      overdue: f.overdue,
    }
  }),
)
</script>

<template>
  <section id="block-nodes" class="rounded-lg border border-border bg-background-card px-4 py-3.5" aria-label="Block lists on each node">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 class="text-sm font-semibold">On each node</h2>
      <p class="text-xs text-gray-500">Each node downloads the lists itself, so its numbers and schedule are its own.</p>
    </div>
    <div class="mt-2 flex flex-col">
      <div
        v-for="r in rows"
        :key="r.name"
        class="block-node flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border py-2.5 first:border-t-0"
      >
        <span class="inline-flex w-28 items-center gap-2 font-mono text-[12.5px]">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: r.color }" />{{ r.short }}
        </span>
        <template v-if="r.readable">
          <div>
            <div class="text-[11.5px] text-gray-500">Domains in the lists</div>
            <div class="text-lg font-bold tabular-nums leading-tight">{{ r.total === null ? "–" : fmtInt(r.total) }}</div>
          </div>
          <div>
            <div class="text-[11.5px] text-gray-500">Last updated</div>
            <div class="text-base font-bold leading-tight">{{ r.last }}</div>
          </div>
          <div>
            <div class="text-[11.5px] text-gray-500">Next update</div>
            <div class="text-base font-bold leading-tight" :class="r.overdue ? 'text-warn' : ''">{{ r.next }}</div>
          </div>
          <span v-if="r.enableBlocking === false" class="rounded-full bg-warn/15 px-2 py-0.5 text-[11.5px] font-semibold text-warn">Blocking off</span>
        </template>
        <span v-else class="text-xs text-warn">Could not be read.</span>
      </div>
    </div>
    <div v-if="isAdmin" class="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-xs text-gray-500">
      <span class="font-semibold">Update now on</span>
      <button
        v-for="o in ['both', ...allNames]"
        :key="o"
        type="button"
        :data-update-on="o"
        :aria-pressed="updateOn === o"
        class="rounded-full border px-2.5 py-0.5"
        :class="updateOn === o ? 'border-accent/50 bg-accent/15 font-semibold text-accent' : 'border-border-hover text-fg'"
        @click="emit('update:updateOn', o)"
      >
        {{ o === "both" ? "Every node" : o.split(".")[0] }}
      </button>
    </div>
  </section>
</template>
