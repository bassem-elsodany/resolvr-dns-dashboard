<script setup lang="ts">
import { ref, onMounted, watch } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import { getSettings, TechnitiumApiError, type DnsSettings } from "../../api/technitium"

const connection = useConnectionStore()
const serverUpdate = useServerUpdateStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const settings = ref<DnsSettings | null>(null)

async function load(): Promise<void> {
  if (!connection.isConfigured) return
  loading.value = true
  loadError.value = null
  try {
    const res = await getSettings(connection.credentials)
    settings.value = res.response
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load server settings."
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(
  () => connection.isConfigured,
  (configured) => {
    if (configured) load()
  },
)
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="text-lg font-semibold tracking-tight text-fg">Server Info</h1>
      <p class="mt-1 text-sm text-gray-500">Read-only snapshot of this node's configuration</p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to see
      its settings.
    </p>
    <p v-else-if="loadError" id="server-info-error" class="text-sm text-crit">{{ loadError }}</p>

    <template v-else-if="settings">
      <div
        v-if="serverUpdate.updateAvailable"
        id="update-banner"
        class="mb-4 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-2.5 text-[12.5px]"
      >
        {{ serverUpdate.updateTitle ?? "A newer version of Technitium DNS Server is available" }}
        <span v-if="serverUpdate.updateVersion" class="font-semibold">&mdash; v{{ serverUpdate.updateVersion }}</span>
      </div>

      <div class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Identity</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Server domain</dt>
            <dd class="font-mono">{{ settings.dnsServerDomain }}</dd>
            <dt class="text-gray-500">Version</dt>
            <dd>{{ settings.version }}</dd>
            <dt class="text-gray-500">Uptime since</dt>
            <dd>{{ new Date(settings.uptimestamp).toLocaleString() }}</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Resolution</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Listening on</dt>
            <dd class="font-mono">{{ settings.dnsServerLocalEndPoints.join(", ") }}</dd>
            <dt class="text-gray-500">IPv6 mode</dt>
            <dd>{{ settings.ipv6Mode }}</dd>
            <dt class="text-gray-500">DNSSEC validation</dt>
            <dd>
              <span
                class="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                :class="settings.dnssecValidation ? 'bg-ok/12 text-ok' : 'bg-background-hover text-gray-500'"
              >
                {{ settings.dnssecValidation ? "Enabled" : "Disabled" }}
              </span>
            </dd>
            <dt class="text-gray-500">EDNS client subnet</dt>
            <dd>{{ settings.eDnsClientSubnet ? "Enabled" : "Disabled" }}</dd>
            <dt class="text-gray-500">UDP payload size</dt>
            <dd class="tabular-nums">{{ settings.udpPayloadSize }} bytes</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Rate limiting</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt v-for="limit in settings.qpmPrefixLimitsIPv4" :key="limit.prefix" class="text-gray-500">
              /{{ limit.prefix }}
            </dt>
            <dd v-for="limit in settings.qpmPrefixLimitsIPv4" :key="'v-' + limit.prefix" class="tabular-nums">
              {{ limit.udpLimit.toLocaleString() }} qpm UDP / {{ limit.tcpLimit.toLocaleString() }} qpm TCP
            </dd>
            <dt class="text-gray-500">Sample window</dt>
            <dd>{{ settings.qpmLimitSampleMinutes }} minutes</dd>
          </dl>
        </div>

        <div class="rounded-lg border border-border bg-background-card p-3.5">
          <div class="mb-2 text-[12.5px] font-semibold">Defaults</div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt class="text-gray-500">Record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultRecordTtl.toLocaleString() }}s</dd>
            <dt class="text-gray-500">NS record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultNsRecordTtl.toLocaleString() }}s</dd>
            <dt class="text-gray-500">SOA record TTL</dt>
            <dd class="tabular-nums">{{ settings.defaultSoaRecordTtl.toLocaleString() }}s</dd>
          </dl>
        </div>
      </div>
    </template>
    <p v-else-if="loading" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
