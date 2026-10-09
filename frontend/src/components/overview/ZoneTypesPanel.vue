<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { listZones, type ZoneSummary } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { cached, groupZoneTypes, ZONE_TYPE_COLORS } from "../../lib/charts"
import ChartPanel from "../charts/ChartPanel.vue"

const connection = useConnectionStore()
const refresh = useRefreshStore()

const zones = ref<ZoneSummary[]>([])
const state = ref<"loading" | "ready" | "error">("loading")

async function load(force = false): Promise<void> {
  if (!connection.isConfigured) return
  try {
    const res = await cached("zones-list", 60_000, () => listZones(connection.credentials, { zonesPerPage: 1000 }), force)
    zones.value = res.response.zones
    state.value = "ready"
  } catch {
    state.value = "error"
  }
}

onMounted(() => void load())
watch(() => refresh.tick, () => void load(true))
watch(() => connection.isConfigured, (c) => c && void load())

const own = computed(() => zones.value.filter((z) => !z.internal))
const groups = computed(() => groupZoneTypes(zones.value))
const signed = computed(() => own.value.filter((z) => z.dnssecStatus && z.dnssecStatus !== "Unsigned").length)
const color = (t: string) => ZONE_TYPE_COLORS[t] ?? "rgb(var(--color-chart-gray))"
</script>

<template>
  <ChartPanel title="Zones by type" :hint="state === 'ready' ? `${own.length} zones, ${signed} DNSSEC signed.` : ''">
    <p v-if="state === 'loading'" class="py-6 text-center text-sm text-gray-500">Loading…</p>
    <p v-else-if="state === 'error'" class="py-6 text-center text-sm text-gray-500">Could not load zones.</p>
    <p v-else-if="groups.length === 0" class="py-6 text-center text-sm text-gray-500">No zones yet.</p>
    <template v-else>
      <div id="zone-stack" class="my-2.5 flex h-3.5 gap-0.5 overflow-hidden rounded">
        <span
          v-for="g in groups"
          :key="g.type"
          class="block h-full"
          :style="{ flex: g.count, background: color(g.type) }"
          :title="`${g.type} ${g.count}`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-gray-500">
        <span v-for="g in groups" :key="g.type" class="zone-legend inline-flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: color(g.type) }" />
          {{ g.type }} {{ g.count }}
        </span>
      </div>
    </template>
  </ChartPanel>
</template>
