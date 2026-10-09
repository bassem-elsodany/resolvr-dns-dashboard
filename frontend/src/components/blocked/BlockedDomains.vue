<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { exportBlockedZones, listBlockedZones, TechnitiumApiError } from "../../api/technitium"
import { blockDomain, unblockDomain, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useRefreshStore } from "../../stores/refresh"
import { triggerDownload } from "../../lib/download"
import { mapLimit } from "../../lib/async"
import { cached } from "../../lib/charts"
import { walkBlockedZones, type WalkResult } from "../../lib/blockedTree"
import { domainStatus, normalizeDomain, planBulk } from "../../lib/blockLists"
import { useUndoToast } from "../../composables/useUndoToast"
import UndoToast from "../ui/UndoToast.vue"
import ZoneTreeNode from "../zones/ZoneTreeNode.vue"

const props = defineProps<{ isAdmin: boolean; highlightDomain: string | null }>()

const connection = useConnectionStore()
const refresh = useRefreshStore()
const { toast, show, runUndo } = useUndoToast()

const CACHE_KEY = "blocked-walk"
const TTL_MS = 60_000

const domains = ref<string[]>([])
const state = ref<"loading" | "ready" | "error">("loading")
const found = ref(0)
const truncated = ref(false)
const loadError = ref<string | null>(null)

const fetchNode = (d: string) => listBlockedZones(connection.credentials, d)

async function load(force = false): Promise<void> {
  if (!connection.isConfigured) return
  state.value = "loading"
  found.value = 0
  try {
    const res = await cached<WalkResult>(
      CACHE_KEY,
      TTL_MS,
      () => walkBlockedZones(fetchNode, { onProgress: (n) => (found.value = n) }),
      force,
    )
    domains.value = res.domains
    truncated.value = res.truncated
    state.value = "ready"
  } catch (err) {
    loadError.value = err instanceof TechnitiumApiError ? err.message : "Could not load your blocked domains."
    state.value = "error"
  }
}

onMounted(() => void load())
watch(() => refresh.tick, () => void load(true))
watch(() => connection.isConfigured, (c) => c && void load())

// Keeps the cached walk in step with changes made here, so coming back to
// the page shows them without walking the tree again.
function remember(): void {
  void cached<WalkResult>(CACHE_KEY, TTL_MS, async () => ({ domains: domains.value, truncated: truncated.value }), true)
}

// Bring a highlighted domain (one a check matched) into view once listed.
watch(
  [() => state.value, () => props.highlightDomain],
  async ([s, d]) => {
    if (s !== "ready" || !d) return
    await nextTick()
    document.querySelector(".blocked-row.bg-accent\\/15")?.scrollIntoView?.({ behavior: "smooth", block: "center" })
  },
  { immediate: true },
)

const blockedSet = computed(() => new Set(domains.value))

// ---------- the list ----------

const filterText = ref("")
const visible = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return q ? domains.value.filter((d) => d.includes(q)) : domains.value
})

function addLocal(...added: string[]): void {
  domains.value = [...new Set([...domains.value, ...added])].sort()
  remember()
}

function removeLocal(...gone: string[]): void {
  const drop = new Set(gone)
  domains.value = domains.value.filter((d) => !drop.has(d))
  remember()
}

const actionError = ref<string | null>(null)

function message(err: unknown, fallback: string): string {
  return err instanceof AppApiError ? err.message : fallback
}

async function unblock(domain: string): Promise<void> {
  actionError.value = null
  try {
    await unblockDomain(domain)
    removeLocal(domain)
    show(`Unblocked ${domain}`, () => void reblock(domain))
  } catch (err) {
    actionError.value = message(err, `Could not unblock ${domain}.`)
  }
}

async function reblock(domain: string): Promise<void> {
  try {
    await blockDomain(domain)
    addLocal(domain)
  } catch (err) {
    actionError.value = message(err, `Could not block ${domain} again.`)
  }
}

// ---------- block one domain ----------

const input = ref("")
const status = computed(() => domainStatus(input.value, blockedSet.value))
const typed = computed(() => normalizeDomain(input.value))
const blocking = ref(false)

const hint = computed(() => {
  const s = status.value
  switch (s.kind) {
    case "empty":
      return { tone: "", text: "Type a domain to see whether it is already blocked." }
    case "invalid":
      return { tone: "bad", text: "That is not a valid domain. Use a name like example.com." }
    case "blocked":
      return { tone: "warn", text: `${typed.value} is already on your list.` }
    case "covered":
      return { tone: "warn", text: `Already covered: ${s.by} is blocked, and that includes ${typed.value}.` }
    case "new":
      return { tone: "ok", text: `${typed.value} is not blocked yet. It will also block everything under it.` }
  }
})

async function blockTyped(): Promise<void> {
  const domain = typed.value
  if (status.value.kind !== "new") return
  blocking.value = true
  actionError.value = null
  try {
    await blockDomain(domain)
    addLocal(domain)
    input.value = ""
    show(`Blocked ${domain}`, () => void unblockQuiet([domain]))
  } catch (err) {
    actionError.value = message(err, "Could not block this domain.")
  } finally {
    blocking.value = false
  }
}

async function unblockQuiet(list: string[]): Promise<void> {
  try {
    await mapLimit(list, 3, (d) => unblockDomain(d))
    removeLocal(...list)
  } catch (err) {
    actionError.value = message(err, "Could not undo that.")
  }
}

async function unblockTyped(): Promise<void> {
  if (status.value.kind === "blocked") await unblock(typed.value)
  input.value = ""
}

// ---------- block many ----------

const bulkOpen = ref(false)
const bulkText = ref("")
const plan = computed(() => planBulk(bulkText.value, blockedSet.value))
const bulkBusy = ref(false)

const bulkSummary = computed(() => {
  if (!bulkText.value.trim()) return ""
  const p = plan.value
  const bad = p.invalid.length ? ` (${p.invalid.slice(0, 3).join(", ")}${p.invalid.length > 3 ? "…" : ""})` : ""
  return `${p.add.length} new, ${p.alreadyBlocked} already blocked, ${p.invalid.length} not valid${bad}.`
})

async function blockMany(): Promise<void> {
  const todo = [...plan.value.add]
  if (todo.length === 0) return
  bulkBusy.value = true
  actionError.value = null
  const done: string[] = []
  const failed: string[] = []
  await mapLimit(todo, 3, async (d) => {
    try {
      await blockDomain(d)
      done.push(d)
    } catch {
      failed.push(d)
    }
  })
  if (done.length) addLocal(...done)
  bulkBusy.value = false
  bulkText.value = ""
  bulkOpen.value = false
  if (failed.length) actionError.value = `Blocked ${done.length} of ${todo.length}. Could not block: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}.`
  if (done.length) show(`Blocked ${done.length} ${done.length === 1 ? "domain" : "domains"}`, () => void unblockQuiet(done))
}

// ---------- export and tree ----------

async function onExport(): Promise<void> {
  try {
    triggerDownload(await exportBlockedZones(connection.credentials))
  } catch (err) {
    actionError.value = err instanceof TechnitiumApiError ? err.message : "Could not export blocked zones."
  }
}

const treeOpen = ref(false)
const roots = ref<string[] | null>(null)
const treeError = ref<string | null>(null)

async function onTreeToggle(e: Event): Promise<void> {
  treeOpen.value = (e.target as HTMLDetailsElement).open
  if (!treeOpen.value || roots.value) return
  try {
    const res = await fetchNode("")
    roots.value = res.response.zones.length ? res.response.zones : [...new Set(res.response.records.map((r) => r.name))]
  } catch (err) {
    treeError.value = err instanceof TechnitiumApiError ? err.message : "Could not load the tree."
  }
}

// The tree's own Remove control also drops the domain from the list above.
const treeDelete = computed(() =>
  props.isAdmin
    ? async (d: string) => {
        const r = await unblockDomain(d)
        removeLocal(d)
        return r
      }
    : undefined,
)
</script>

<template>
  <section class="rounded-lg border border-border bg-background-card p-4" aria-label="Your blocked domains">
    <h2 class="text-sm font-semibold">Your blocked domains</h2>
    <p class="mb-3 mt-0.5 text-xs text-gray-500">Domains you block yourself, on top of the feeds. Blocking a domain also blocks everything under it.</p>

    <template v-if="isAdmin">
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="status.kind === 'blocked' ? unblockTyped() : blockTyped()">
        <input
          id="new-blocked-domain"
          v-model="input"
          type="text"
          placeholder="Type a domain, for example ads.example.net"
          aria-label="Domain to block"
          autocomplete="off"
          class="min-w-0 flex-[1_1_280px] rounded-md border border-border-hover bg-background-card px-2.5 py-1.5 font-mono text-[13px]"
        />
        <button
          v-if="status.kind === 'blocked'"
          id="unblock-typed"
          type="submit"
          class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white"
        >
          Unblock
        </button>
        <button
          v-else
          id="add-blocked-domain"
          type="submit"
          :disabled="status.kind !== 'new' || blocking"
          class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {{ blocking ? "Blocking…" : status.kind === "new" ? `Block ${typed}` : "Block" }}
        </button>
        <button id="bulk-toggle" type="button" class="rounded-md border border-border-hover px-3 py-1.5 text-[13px]" @click="bulkOpen = !bulkOpen">
          Paste a list
        </button>
      </form>
      <p
        id="domain-hint"
        class="mt-1.5 min-h-[18px] text-[12.5px]"
        :class="{ 'text-crit': hint.tone === 'bad', 'text-ok': hint.tone === 'ok', 'text-warn': hint.tone === 'warn', 'text-gray-500': !hint.tone }"
      >
        {{ hint.text }}
      </p>

      <div v-if="bulkOpen" id="bulk-box" class="mt-1">
        <textarea
          id="bulk-text"
          v-model="bulkText"
          placeholder="One domain per line"
          aria-label="Domains to block, one per line"
          class="min-h-[120px] w-full rounded-lg border border-border-hover bg-background-card p-2.5 font-mono text-[12.5px] leading-6"
        />
        <p id="bulk-summary" class="my-1 min-h-[18px] text-[12.5px] text-gray-500">{{ bulkSummary }}</p>
        <button
          id="bulk-block"
          type="button"
          :disabled="plan.add.length === 0 || bulkBusy"
          class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          @click="blockMany"
        >
          {{ bulkBusy ? "Blocking…" : plan.add.length ? `Block ${plan.add.length} ${plan.add.length === 1 ? "domain" : "domains"}` : "Block domains" }}
        </button>
        <button type="button" class="ml-2 rounded-md border border-border-hover px-3 py-1.5 text-[13px]" @click="((bulkOpen = false), (bulkText = ''))">Cancel</button>
      </div>
    </template>
    <p v-else class="rounded-lg bg-background-hover px-3 py-2 text-[12.5px] text-gray-500">Only admins can block or unblock domains.</p>

    <p v-if="actionError" id="blocked-action-error" class="mt-2 text-sm text-crit">{{ actionError }}</p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input
        id="blocked-filter"
        v-model="filterText"
        type="search"
        placeholder="Filter your blocked domains"
        aria-label="Filter blocked domains"
        class="min-w-0 flex-[1_1_200px] rounded-md border border-border-hover bg-background-card px-2.5 py-1 text-[13px]"
      />
      <span id="blocked-count" class="text-xs tabular-nums text-gray-500">{{ visible.length }} of {{ domains.length }}</span>
      <button id="export-blocked" type="button" class="rounded-md border border-border-hover px-3 py-1 text-[13px]" @click="onExport">Export</button>
    </div>

    <p v-if="state === 'loading'" id="blocked-loading" class="mt-3 text-sm text-gray-500">Loading your blocked domains… {{ found }} found so far.</p>
    <p v-else-if="state === 'error'" id="blocked-error" class="mt-3 text-sm text-crit">{{ loadError }}</p>
    <template v-else>
      <p v-if="truncated" id="blocked-truncated" class="mt-2 text-xs text-warn">The list is very large, so only the first part is shown. Use the tree below to browse the rest.</p>
      <p v-if="visible.length === 0" class="mt-3 text-sm text-gray-500">{{ domains.length === 0 ? "You have not blocked any domains yet." : "No domains match." }}</p>
      <ul v-else id="blocked-domain-list" class="mt-2.5 flex flex-col">
        <li
          v-for="d in visible"
          :key="d"
          class="blocked-row flex items-center justify-between gap-2.5 border-t border-border/60 px-1 py-1.5"
          :class="d === highlightDomain ? 'bg-accent/15' : ''"
        >
          <span class="break-all font-mono text-[13px]">{{ d }}</span>
          <button v-if="isAdmin" type="button" class="row-unblock rounded px-2 py-0.5 text-[12.5px] text-gray-400 hover:bg-background-hover" @click="unblock(d)">Unblock</button>
        </li>
      </ul>
    </template>

    <details class="mt-3.5 border-t border-border pt-2.5" @toggle="onTreeToggle">
      <summary class="cursor-pointer text-[13px] font-semibold">Browse as a tree</summary>
      <p v-if="treeError" class="mt-2 text-sm text-crit">{{ treeError }}</p>
      <ul v-else-if="roots" id="blocked-zone-tree" class="mt-2">
        <ZoneTreeNode v-for="d in roots" :key="d" :domain="d" :depth="0" :fetch-node="fetchNode" :delete-domain="treeDelete" />
      </ul>
      <p v-else-if="treeOpen" class="mt-2 text-sm text-gray-500">Loading…</p>
    </details>
    <UndoToast :toast="toast" @undo="runUndo" />
  </section>
</template>
