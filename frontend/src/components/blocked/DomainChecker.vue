<script setup lang="ts">
import { ref } from "vue"
import { resolveDnsQuery, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { isValidDomain, normalizeDomain, parseVerdict, type Verdict } from "../../lib/blockLists"

// On a cluster each node downloads the lists itself, so each can answer
// differently while one lags: `targets` asks every node in scope.
const props = defineProps<{ targets?: { node: string | undefined; name: string }[] }>()

const emit = defineEmits<{
  (e: "matched", match: { feed: string | null; domain: string | null }): void
  // Asks the page to bring forward the tab that holds what matched.
  (e: "show", tab: "feeds" | "domains"): void
}>()
const connection = useConnectionStore()

const input = ref("")
const checking = ref(false)
const verdict = ref<Verdict | null>(null)
const checkedName = ref("")
const message = ref<string | null>(null)
const perNode = ref<{ name: string; verdict: Verdict | null }[]>([])

async function check(): Promise<void> {
  const name = normalizeDomain(input.value)
  verdict.value = null
  message.value = null
  perNode.value = []
  emit("matched", { feed: null, domain: null })
  if (!isValidDomain(name)) {
    message.value = "Enter a domain like example.com."
    return
  }
  checking.value = true
  checkedName.value = name
  try {
    const many = props.targets && props.targets.length > 1 ? props.targets : null
    if (many) {
      const settled = await Promise.allSettled(
        many.map(async (t) => {
          const res = await resolveDnsQuery(name, "A", connection.credentials, {
            server: "this-server",
            protocol: "Udp",
            ...(t.node ? { node: t.node } : {}),
          })
          return parseVerdict(res)
        }),
      )
      perNode.value = settled.map((s, i) => ({ name: many[i]!.name, verdict: s.status === "fulfilled" ? s.value : null }))
      const answered = perNode.value.flatMap((p) => (p.verdict ? [p.verdict] : []))
      if (answered.length === 0) throw new TechnitiumApiError("No node could be asked.", 0)
      // The page points at what matched, so prefer a node that blocked it.
      verdict.value = answered.find((v) => v.kind === "blocked") ?? answered[0]!
    } else {
      // "this-server" asks your own server, so its blocking applies.
      const res = await resolveDnsQuery(name, "A", connection.credentials, { server: "this-server", protocol: "Udp" })
      verdict.value = parseVerdict(res)
    }
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

    <ul v-if="perNode.length > 1" id="check-per-node" class="mt-2.5 flex flex-col gap-1.5 text-[12.5px]">
      <li v-for="p in perNode" :key="p.name" class="flex flex-wrap items-center gap-2">
        <span class="w-24 font-mono text-gray-500">{{ p.name.split(".")[0] }}</span>
        <span v-if="!p.verdict" class="text-warn">could not be asked</span>
        <span v-else-if="p.verdict.kind === 'blocked'" class="font-semibold text-crit">Blocked</span>
        <span v-else-if="p.verdict.kind === 'allowed'" class="font-semibold text-ok">Allowed</span>
        <span v-else-if="p.verdict.kind === 'not-found'" class="text-gray-500">Not found</span>
        <span v-else class="text-gray-500">No clear answer</span>
      </li>
    </ul>

    <p v-if="message" id="check-message" class="mt-2.5 rounded-lg bg-background-hover px-3 py-2 text-[13px] text-gray-300">{{ message }}</p>
    <div v-if="verdict" id="check-verdict" class="mt-2.5 rounded-lg px-3 py-2.5 text-[13px]" :class="verdict.kind === 'blocked' ? 'bg-crit/12 text-crit' : verdict.kind === 'allowed' ? 'bg-ok/15 text-ok' : 'bg-background-hover text-gray-300'">
      <template v-if="verdict.kind === 'blocked'">
        <b>Blocked.</b>{{ " " }}
        <template v-if="verdict.source === 'feed'">
          <span class="break-words">{{ checkedName }} matches a feed<template v-if="verdict.feedUrl">: <span class="font-mono">{{ verdict.feedUrl }}</span></template>.</span>
          <button v-if="verdict.feedUrl" id="show-feed" type="button" class="ml-2 font-semibold underline" @click="emit('show', 'feeds')">Show in Feeds</button>
        </template>
        <template v-else-if="verdict.source === 'own'">{{ checkedName }} is on your blocked domains<template v-if="verdict.matched && verdict.matched !== checkedName"> (through {{ verdict.matched }})</template>.
          <button id="show-domain" type="button" class="ml-2 font-semibold underline" @click="emit('show', 'domains')">Show in your domains</button>
        </template>
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
