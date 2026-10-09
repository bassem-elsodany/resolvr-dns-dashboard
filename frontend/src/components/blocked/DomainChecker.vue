<script setup lang="ts">
import { ref } from "vue"
import { resolveDnsQuery, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { isValidDomain, normalizeDomain, parseVerdict, type Verdict } from "../../lib/blockLists"

const emit = defineEmits<{ (e: "matched", match: { feed: string | null; domain: string | null }): void }>()
const connection = useConnectionStore()

const input = ref("")
const checking = ref(false)
const verdict = ref<Verdict | null>(null)
const checkedName = ref("")
const message = ref<string | null>(null)

async function check(): Promise<void> {
  const name = normalizeDomain(input.value)
  verdict.value = null
  message.value = null
  emit("matched", { feed: null, domain: null })
  if (!isValidDomain(name)) {
    message.value = "Enter a domain like example.com."
    return
  }
  checking.value = true
  checkedName.value = name
  try {
    // "this-server" asks your own server, so its blocking applies.
    const res = await resolveDnsQuery(name, "A", connection.credentials, { server: "this-server", protocol: "Udp" })
    verdict.value = parseVerdict(res)
    if (verdict.value.kind === "blocked") {
      emit("matched", { feed: verdict.value.source === "feed" ? verdict.value.feedUrl : null, domain: verdict.value.source === "own" ? verdict.value.matched : null })
    }
  } catch (err) {
    message.value = err instanceof TechnitiumApiError ? err.message : "Could not ask the server."
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <section class="rounded-lg border border-border bg-background-card p-4" aria-label="Check a domain">
    <h2 class="text-sm font-semibold">Check a domain</h2>
    <p class="mb-3 mt-0.5 text-xs text-gray-500">Asks your server whether it would answer or refuse a name, and which feed or entry blocked it.</p>
    <form class="flex flex-wrap gap-2" @submit.prevent="check">
      <input
        id="check-domain"
        v-model="input"
        type="text"
        placeholder="example.com"
        aria-label="Domain to check"
        autocomplete="off"
        class="min-w-0 flex-[1_1_260px] rounded-md border border-border-hover bg-background-card px-2.5 py-1.5 font-mono text-[13px]"
      />
      <button id="check-go" type="submit" :disabled="checking" class="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
        {{ checking ? "Checking…" : "Check" }}
      </button>
    </form>

    <p v-if="message" id="check-message" class="mt-2.5 rounded-lg bg-background-hover px-3 py-2 text-[13px] text-gray-300">{{ message }}</p>
    <div v-if="verdict" id="check-verdict" class="mt-2.5 rounded-lg px-3 py-2.5 text-[13px]" :class="verdict.kind === 'blocked' ? 'bg-crit/12 text-crit' : verdict.kind === 'allowed' ? 'bg-ok/15 text-ok' : 'bg-background-hover text-gray-300'">
      <template v-if="verdict.kind === 'blocked'">
        <b>Blocked.</b>{{ " " }}
        <template v-if="verdict.source === 'feed'">
          <span class="break-words">{{ checkedName }} matches a feed<template v-if="verdict.feedUrl">: <span class="font-mono">{{ verdict.feedUrl }}</span></template>.</span>
        </template>
        <template v-else-if="verdict.source === 'own'">{{ checkedName }} is on your blocked domains<template v-if="verdict.matched && verdict.matched !== checkedName"> (through {{ verdict.matched }})</template>.</template>
        <template v-else>The server refused {{ checkedName }}: <span class="font-mono">{{ verdict.detail }}</span></template>
      </template>
      <template v-else-if="verdict.kind === 'allowed'">
        <b>Allowed.</b> Your server answers {{ checkedName }} normally<template v-if="verdict.addresses.length"> with {{ verdict.addresses.slice(0, 3).join(", ") }}</template>.
      </template>
      <template v-else-if="verdict.kind === 'not-found'"><b>Not found.</b>{{ " " }}{{ checkedName }} does not exist, and it is not blocked.</template>
      <template v-else><b>No clear answer.</b>{{ " " }}The server replied {{ verdict.rcode }}.</template>
    </div>
  </section>
</template>
