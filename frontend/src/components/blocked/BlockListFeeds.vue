<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  describeChanges,
  diffFeeds,
  groupsToLines,
  newGroupId,
  parseFeedLines,
  validateFeedUrl,
  type FeedGroup,
} from "../../lib/blockLists"

const props = defineProps<{
  // The feed list as the server holds it: "# heading" lines and URLs.
  lines: string[]
  isAdmin: boolean
  saving: boolean
  saveError: string | null
  // A feed to point out, e.g. the one a domain check matched.
  highlightUrl: string | null
}>()

const emit = defineEmits<{ (e: "save", lines: string[], updateAfter: boolean): void }>()

const draft = ref<FeedGroup[]>(parseFeedLines(props.lines))
const changes = computed(() => diffFeeds(props.lines, draft.value))
defineExpose({ hasChanges: computed(() => changes.value.dirty) })

// A fresh list from the server (after saving, or a refresh) replaces the
// draft, unless the admin is in the middle of editing.
watch(
  () => props.lines,
  (next, previous) => {
    // "Being edited" means the draft differs from the list it was made from.
    if (!diffFeeds(previous, draft.value).dirty) draft.value = parseFeedLines(next)
  },
)
watch(
  () => props.saving,
  (now, was) => {
    if (was && !now && !props.saveError) draft.value = parseFeedLines(props.lines)
  },
)

const allUrls = computed(() => draft.value.flatMap((g) => g.feeds.filter((f) => f.state !== "removed").map((f) => f.url)))

function removeFeed(g: FeedGroup, i: number): void {
  const f = g.feeds[i]!
  if (f.state === "added") g.feeds.splice(i, 1)
  else f.state = "removed"
}

// A heading with no feeds under it is just a divider; it goes only when
// the admin removes it.
function removeGroup(gi: number): void {
  draft.value.splice(gi, 1)
}

function liveCount(g: FeedGroup): number {
  return g.feeds.filter((f) => f.state !== "removed").length
}

function undoRemove(g: FeedGroup, i: number): void {
  g.feeds[i]!.state = "same"
}

// Moving past the top or bottom of a group continues into the next one.
function move(gi: number, i: number, dir: -1 | 1): void {
  const g = draft.value[gi]!
  const f = g.feeds[i]!
  const ni = i + dir
  if (ni >= 0 && ni < g.feeds.length) {
    g.feeds.splice(i, 1)
    g.feeds.splice(ni, 0, f)
    return
  }
  const neighbour = draft.value[gi + dir]
  if (!neighbour) return
  g.feeds.splice(i, 1)
  if (dir < 0) neighbour.feeds.push(f)
  else neighbour.feeds.unshift(f)
}

// ---------- adding ----------

const newUrl = ref("")
const newGroup = ref<string>("")
// Until the admin picks a group themselves, new feeds go to the first one
// (or to a new group when the list is empty).
const groupChosen = ref(false)
const addError = ref<string | null>(null)

watch(
  () => draft.value.map((g) => g.id).join(","),
  () => {
    const exists = newGroup.value === "new" || draft.value.some((g) => String(g.id) === newGroup.value)
    if (!groupChosen.value || !exists) newGroup.value = draft.value[0] ? String(draft.value[0].id) : "new"
  },
  { immediate: true },
)

function addFeed(): void {
  const err = validateFeedUrl(newUrl.value, allUrls.value)
  addError.value = err
  if (err) return
  let group = newGroup.value === "new" ? null : draft.value.find((g) => String(g.id) === newGroup.value)
  if (!group) {
    group = { id: newGroupId(), name: draft.value.length ? "New group" : "", feeds: [] }
    draft.value.push(group)
    newGroup.value = String(group.id)
  }
  group.feeds.push({ url: newUrl.value.trim(), state: "added" })
  newUrl.value = ""
}

// ---------- text mode ----------

const textMode = ref(false)
const text = ref("")

function openText(): void {
  text.value = groupsToLines(draft.value).join("\n")
  textMode.value = true
}

function applyText(): void {
  const saved = new Set(props.lines.map((l) => l.trim()))
  const groups = parseFeedLines(text.value.split("\n"))
  groups.forEach((g) => g.feeds.forEach((f) => (f.state = saved.has(f.url) ? "same" : "added")))
  draft.value = groups
  textMode.value = false
}

// ---------- saving ----------

function discard(): void {
  draft.value = parseFeedLines(props.lines)
  addError.value = null
}

function save(updateAfter: boolean): void {
  emit("save", groupsToLines(draft.value), updateAfter)
}

// Scroll to a feed the page was asked to point at.
watch(
  () => props.highlightUrl,
  async (url) => {
    if (!url) return
    await nextTick()
    document.querySelector('[data-highlight="true"]')?.scrollIntoView?.({ behavior: "smooth", block: "center" })
  },
)
</script>

<template>
  <section class="rounded-lg border border-border bg-background-card p-4" aria-label="Block list feeds">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
      <div>
        <h2 class="text-sm font-semibold">Feeds</h2>
        <p class="mt-0.5 text-xs text-gray-500">The lists your server downloads and merges. Group them with a heading to keep them tidy.</p>
      </div>
      <button v-if="isAdmin && !textMode" id="feeds-text-mode" type="button" class="rounded-md border border-border-hover px-3 py-1.5 text-[12.5px]" @click="openText">
        Edit as text
      </button>
    </div>

    <template v-if="!textMode">
      <p v-if="draft.length === 0" id="feeds-empty" class="mt-3 text-sm text-gray-500">
        No feeds yet.<span v-if="isAdmin"> Add one below.</span>
      </p>
      <div v-for="(g, gi) in draft" :key="g.id" class="feed-group mt-2.5 overflow-hidden rounded-lg border border-border">
        <div class="flex items-center gap-2 bg-background-hover px-2.5 py-1.5">
          <input
            v-model="g.name"
            :disabled="!isAdmin"
            aria-label="Group name"
            placeholder="Ungrouped"
            class="group-name min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[12.5px] font-bold uppercase tracking-wide text-gray-300 enabled:hover:border-border-hover enabled:focus:border-border-hover enabled:focus:bg-background-card"
          />
          <span class="group-count text-xs text-gray-500">{{ liveCount(g) === 0 ? "Divider" : liveCount(g) === 1 ? "1 feed" : `${liveCount(g)} feeds` }}</span>
          <button
            v-if="isAdmin && liveCount(g) === 0"
            type="button"
            class="group-remove rounded px-2 py-0.5 text-[12.5px] text-gray-400 hover:bg-background-card"
            @click="removeGroup(gi)"
          >
            Remove heading
          </button>
        </div>
        <div
          v-for="(f, i) in g.feeds"
          :key="f.url"
          class="feed-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60 px-2.5 py-1.5"
          :class="[f.state === 'added' ? 'bg-ok/10' : f.state === 'removed' ? 'bg-crit/10' : '', f.url === highlightUrl ? 'bg-accent/15' : '']"
          :data-highlight="f.url === highlightUrl"
        >
          <span class="break-all font-mono text-[12.5px]" :class="f.state === 'removed' ? 'text-gray-500 line-through' : ''">
            <a :href="f.url" target="_blank" rel="noopener noreferrer" class="hover:text-accent hover:underline">{{ f.url }}</a>
            <span v-if="f.state === 'added'" class="ml-1.5 rounded border border-ok px-1 font-sans text-[10px] font-bold uppercase text-ok">New</span>
            <span v-else-if="f.state === 'removed'" class="ml-1.5 rounded border border-crit px-1 font-sans text-[10px] font-bold uppercase text-crit">Removing</span>
            <span v-else-if="f.url === highlightUrl" class="ml-1.5 rounded border border-accent px-1 font-sans text-[10px] font-bold uppercase text-accent">Matched</span>
          </span>
          <span v-if="isAdmin" class="flex items-center gap-0.5">
            <button v-if="f.state === 'removed'" type="button" class="feed-undo rounded px-2 py-0.5 text-[12.5px] hover:bg-background-hover" @click="undoRemove(g, i)">Undo</button>
            <template v-else>
              <button type="button" aria-label="Move up" class="feed-up rounded px-2 py-0.5 text-[12.5px] text-gray-400 hover:bg-background-hover disabled:opacity-30" :disabled="gi === 0 && i === 0" @click="move(gi, i, -1)">▲</button>
              <button type="button" aria-label="Move down" class="feed-down rounded px-2 py-0.5 text-[12.5px] text-gray-400 hover:bg-background-hover disabled:opacity-30" :disabled="gi === draft.length - 1 && i === g.feeds.length - 1" @click="move(gi, i, 1)">▼</button>
              <button type="button" aria-label="Remove feed" class="feed-remove rounded px-2 py-0.5 text-[12.5px] text-gray-400 hover:bg-background-hover" @click="removeFeed(g, i)">Remove</button>
            </template>
          </span>
        </div>
      </div>

      <form v-if="isAdmin" class="mt-3 flex flex-wrap items-start gap-2" @submit.prevent="addFeed">
        <input
          id="new-feed-url"
          v-model="newUrl"
          type="text"
          placeholder="https://example.com/blocklist.txt"
          aria-label="Feed address"
          autocomplete="off"
          class="min-w-0 flex-[1_1_320px] rounded-md border border-border-hover bg-background-card px-2.5 py-1.5 font-mono text-[12.5px]"
        />
        <select id="new-feed-group" v-model="newGroup" aria-label="Group" @change="groupChosen = true" class="rounded-md border border-border-hover bg-background-card px-2.5 py-1.5 text-[13px]">
          <option v-for="g in draft" :key="g.id" :value="String(g.id)">{{ g.name || "Ungrouped" }}</option>
          <option value="new">New group…</option>
        </select>
        <button id="add-feed" type="submit" class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white">Add feed</button>
      </form>
      <p v-if="addError" id="add-feed-error" class="mt-1 text-xs text-crit">{{ addError }}</p>
      <p v-if="!isAdmin" class="mt-3 rounded-lg bg-background-hover px-3 py-2 text-[12.5px] text-gray-500">
        You can see the feeds but not change them. Ask an admin to add or remove feeds.
      </p>
    </template>

    <div v-else id="feeds-text-editor" class="mt-3">
      <p class="mb-1.5 text-xs text-gray-500">One entry per line. A line starting with # is a group heading.</p>
      <textarea
        id="feeds-text"
        v-model="text"
        spellcheck="false"
        aria-label="Feeds as text"
        class="min-h-[220px] w-full rounded-lg border border-border-hover bg-background-card p-2.5 font-mono text-[12.5px] leading-6"
      />
      <div class="mt-2 flex gap-2">
        <button id="feeds-text-apply" type="button" class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white" @click="applyText">Apply to list</button>
        <button type="button" class="rounded-md border border-border-hover px-3 py-1.5 text-[13px]" @click="textMode = false">Cancel</button>
      </div>
    </div>

    <div
      v-if="isAdmin && changes.dirty && !textMode"
      id="feeds-savebar"
      class="sticky bottom-3 mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-fg px-3.5 py-2.5 text-background-canvas shadow-lg"
    >
      <span><b>Unsaved changes:</b> {{ describeChanges(changes) }}</span>
      <span class="ml-auto flex flex-wrap gap-2">
        <button id="feeds-discard" type="button" class="rounded-md border border-background-canvas/45 px-3 py-1 text-[13px]" @click="discard">Discard</button>
        <button id="feeds-save" type="button" :disabled="saving" class="rounded-md border border-background-canvas/45 px-3 py-1 text-[13px] disabled:opacity-50" @click="save(false)">
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <button id="feeds-save-update" type="button" :disabled="saving" class="rounded-md bg-accent px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-50" @click="save(true)">
          Save and update now
        </button>
      </span>
    </div>
    <p v-if="saveError" id="feeds-save-error" class="mt-2 text-sm text-crit">{{ saveError }}</p>
  </section>
</template>
