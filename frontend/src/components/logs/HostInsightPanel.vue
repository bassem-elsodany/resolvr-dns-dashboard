<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  ip: string
  hostname: string | null
  total: number
  blocked: number
  cacheBlocked: number
  upstreamBlocked: number
}>()

const allowedPct = computed(() => (props.total > 0 ? Math.round(((props.total - props.blocked) / props.total) * 100) : 0))

// "Blocked" here means the generic mechanism (Blocked Zone / Block List /
// Advanced Blocking app combined) — see src/lib/blockMechanism.ts for why
// it can't be split further.
const genericBlocked = computed(() => Math.max(0, props.blocked - props.cacheBlocked - props.upstreamBlocked))
const maxBreakdown = computed(() => Math.max(1, genericBlocked.value, props.cacheBlocked, props.upstreamBlocked))
</script>

<template>
  <div id="host-insight" class="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-border bg-background-elevated p-4 md:grid-cols-2">
    <div>
      <div class="text-[12.5px] font-semibold">Allowed vs. blocked</div>
      <div class="font-mono text-[11px] text-gray-500">{{ ip }}<span v-if="hostname"> &middot; {{ hostname }}</span></div>
      <div class="mt-3 flex items-center gap-4">
        <div
          class="flex h-24 w-24 flex-none items-center justify-center rounded-full"
          :style="{
            background: `conic-gradient(rgb(var(--color-ok)) 0 ${allowedPct}%, rgb(var(--color-crit)) ${allowedPct}% 100%)`,
          }"
        >
          <div class="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-background-card">
            <span class="text-base font-bold tabular-nums">{{ allowedPct }}%</span>
            <span class="text-[8px] font-semibold uppercase text-gray-500">Allowed</span>
          </div>
        </div>
        <div class="flex flex-col gap-1 text-xs">
          <div>Allowed <span class="ml-2 tabular-nums text-gray-500">{{ (total - blocked).toLocaleString() }}</span></div>
          <div>Blocked <span class="ml-2 tabular-nums text-gray-500">{{ blocked.toLocaleString() }}</span></div>
          <div class="text-gray-500">{{ total.toLocaleString() }} queries</div>
        </div>
      </div>
    </div>

    <div>
      <div class="text-[12.5px] font-semibold">Blocked by</div>
      <div class="text-[11px] text-gray-500">Blocking mechanism reported by the resolver</div>
      <div class="mt-3 flex flex-col gap-2">
        <div v-for="row in [
          { label: 'Blocked (zone / list)', n: genericBlocked },
          { label: 'Cache Block', n: cacheBlocked },
          { label: 'Upstream Block', n: upstreamBlocked },
        ]" :key="row.label" class="flex items-center gap-2 text-[11px]">
          <span class="w-32 flex-none text-gray-500">{{ row.label }}</span>
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-background-hover">
            <div class="h-full rounded-full bg-crit" :style="{ width: `${(row.n / maxBreakdown) * 100}%` }" />
          </div>
          <span class="w-8 text-right tabular-nums">{{ row.n }}</span>
        </div>
      </div>
    </div>

    <p class="md:col-span-2 text-[11px] leading-relaxed text-gray-500">
      Technitium reports <em>how</em> a query was blocked (zone/list/app vs. cache vs. upstream) but
      not the specific list file or rule &mdash; that detail isn't exposed by the DNS server's API.
    </p>
  </div>
</template>
