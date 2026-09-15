<script setup lang="ts">
import { ref } from "vue"
import { useConnectionStore } from "../stores/connection"
import { resolveDnsQuery, TechnitiumApiError, type ResolveResult } from "../api/technitium"
import { formatRecordValue } from "../lib/formatRecordValue"

const connection = useConnectionStore()

const domain = ref("")
const type = ref("A")
const protocol = ref("Udp")

const loading = ref(false)
const resolveError = ref<string | null>(null)
const result = ref<ResolveResult["response"]["result"] | null>(null)

async function resolve(): Promise<void> {
  const target = domain.value.trim()
  if (!target || !connection.isConfigured) return
  loading.value = true
  resolveError.value = null
  result.value = null
  try {
    const res = await resolveDnsQuery(target, type.value, connection.credentials, {
      server: "this-server",
      protocol: protocol.value,
    })
    result.value = res.response.result
  } catch (err) {
    resolveError.value = err instanceof TechnitiumApiError ? err.message : "Could not resolve this query."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="text-lg font-semibold tracking-tight text-fg">DNS Resolver</h1>
      <p class="mt-1 text-sm text-gray-500">
        Run an ad-hoc query through this server to see exactly what it would answer a client
      </p>
    </div>

    <p v-if="!connection.isConfigured" class="text-sm text-gray-500">
      Connect to a Technitium server on the
      <router-link to="/connect" class="font-medium text-accent">Connection Settings</router-link> page to
      use the resolver.
    </p>

    <template v-else>
      <form class="mb-5 flex flex-wrap items-end gap-2" @submit.prevent="resolve">
        <div class="min-w-[200px] flex-1">
          <label for="resolve-domain" class="mb-1 block text-[11px] font-semibold text-gray-500">Domain name</label>
          <input
            id="resolve-domain"
            v-model="domain"
            placeholder="example.com"
            class="w-full rounded-md border border-border bg-background-card px-3 py-1.5 font-mono text-sm"
          />
        </div>
        <div class="w-28">
          <label for="resolve-type" class="mb-1 block text-[11px] font-semibold text-gray-500">Type</label>
          <select id="resolve-type" v-model="type" class="w-full rounded-md border border-border bg-background-card px-2.5 py-1.5 text-sm">
            <option>A</option>
            <option>AAAA</option>
            <option>HTTPS</option>
            <option>MX</option>
            <option>TXT</option>
            <option>NS</option>
            <option>CNAME</option>
            <option>SOA</option>
          </select>
        </div>
        <div class="w-32">
          <label for="resolve-protocol" class="mb-1 block text-[11px] font-semibold text-gray-500">Protocol</label>
          <select id="resolve-protocol" v-model="protocol" class="w-full rounded-md border border-border bg-background-card px-2.5 py-1.5 text-sm">
            <option value="Udp">UDP</option>
            <option value="Tcp">TCP</option>
            <option value="Tls">DoT</option>
            <option value="Https">DoH</option>
          </select>
        </div>
        <button
          id="resolve-submit"
          type="submit"
          :disabled="loading"
          class="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ loading ? "Resolving…" : "Resolve" }}
        </button>
      </form>

      <p v-if="resolveError" id="resolve-error" class="text-sm text-crit">{{ resolveError }}</p>

      <div v-else-if="result" id="resolve-result" class="rounded-lg border border-border bg-background-elevated p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="font-mono text-[12.5px]">
            {{ result.Question[0]?.Name }} &middot; {{ result.Question[0]?.Type }} &middot;
            via {{ result.Metadata.NameServer }}
          </div>
          <span
            class="rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
            :class="result.RCODE === 'NoError' ? 'bg-ok/12 text-ok' : 'bg-crit/12 text-crit'"
          >
            {{ result.RCODE }} &middot; {{ result.Metadata.RoundTripTime }}
          </span>
        </div>

        <div v-if="result.Answer.length === 0" class="text-sm text-gray-500">No answer records.</div>
        <div v-else class="flex flex-col gap-1.5 font-mono text-[12px]">
          <div v-for="(record, i) in result.Answer" :key="i">
            <span class="text-gray-500">{{ record.Name }}</span>
            {{ record.Type }}
            <span v-if="record.TTL" class="text-gray-500">TTL {{ record.TTL }}</span>
            {{ record.RDATA ? formatRecordValue(record.RDATA) : "" }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
