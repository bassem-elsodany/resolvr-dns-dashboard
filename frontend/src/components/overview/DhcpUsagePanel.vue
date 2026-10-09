<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { listDhcpLeases, listDhcpScopes } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { cached, scopeSize } from "../../lib/charts"
import ChartPanel from "../charts/ChartPanel.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()

interface Row {
  name: string
  used: number
  size: number
}
const rows = ref<Row[]>([])
const state = ref<"loading" | "ready" | "error">("loading")

async function fetchRows(): Promise<Row[]> {
  const [scopes, leases] = await Promise.all([listDhcpScopes(connection.credentials), listDhcpLeases(connection.credentials)])
  const used = new Map<string, number>()
  for (const l of leases.response.leases) used.set(l.scope, (used.get(l.scope) ?? 0) + 1)
  const out: Row[] = []
  for (const s of scopes.response.scopes) {
    if (!s.enabled) continue
    const size = scopeSize(s.startingAddress, s.endingAddress)
    if (size) out.push({ name: s.name, used: used.get(s.name) ?? 0, size })
  }
  return out
}

async function load(force = false): Promise<void> {
  if (!connection.isConfigured) return
  try {
    rows.value = await cached("dhcp-usage", 60_000, fetchRows, force)
    state.value = "ready"
  } catch {
    state.value = "error"
  }
}

onMounted(() => void load())
watch(() => refresh.tick, () => void load(true))
watch(() => connection.isConfigured, (c) => c && void load())

const HOT = 0.9
const hottest = computed(() => [...rows.value].sort((a, b) => b.used / b.size - a.used / a.size)[0])
const warning = computed(() => {
  const h = hottest.value
  return h && h.used / h.size >= HOT ? `${h.name} is ${Math.round((h.used / h.size) * 100)}% full. New devices may fail to get an address.` : null
})
</script>

<template>
  <!-- A server without DHCP has nothing to show, so the panel stays out of the way. -->
  <ChartPanel v-if="state === 'loading' || rows.length > 0" title="DHCP scope usage" hint="Active leases against the size of each enabled scope.">
    <p v-if="state === 'loading'" class="py-6 text-center text-sm text-gray-500">Loading…</p>
    <template v-else>
      <div
        v-for="r in rows"
        :key="r.name"
        class="dhcp-row my-2 grid grid-cols-[90px_1fr_74px] items-center gap-2 text-[12.5px]"
        :class="r.used / r.size >= HOT ? 'dhcp-hot' : ''"
      >
        <span class="truncate" :title="r.name">{{ r.name }}</span>
        <span class="h-2.5 overflow-hidden rounded-full bg-background-hover">
          <span
            class="block h-full rounded-full"
            :class="r.used / r.size >= HOT ? 'bg-chart-orange' : 'bg-chart-blue'"
            :style="{ width: `${Math.min(100, (r.used / r.size) * 100)}%` }"
          />
        </span>
        <span class="text-right tabular-nums text-gray-500">{{ r.used }}/{{ r.size }}{{ r.used / r.size >= HOT ? " ▲" : "" }}</span>
      </div>
      <p v-if="warning" id="dhcp-warning" class="mt-2 text-[11.5px] text-gray-500">{{ warning }}</p>
    </template>
  </ChartPanel>
</template>
