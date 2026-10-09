<script setup lang="ts" generic="T extends string">
import { nextTick } from "vue"

export interface TabItem<I extends string> {
  id: I
  label: string
  // A small marker on the tab, for example "unsaved changes".
  flag?: string | null
}

const props = defineProps<{
  tabs: readonly TabItem<T>[]
  modelValue: T
  // Each tab gets the id `${idPrefix}-${tab id}`; the panel it controls is `panelId`.
  idPrefix: string
  panelId: string
  label: string
}>()

const emit = defineEmits<{ (e: "update:modelValue", id: T): void }>()

// Left/Right/Home/End move between tabs, as for any tab list.
function onKey(e: KeyboardEvent): void {
  const i = props.tabs.findIndex((t) => t.id === props.modelValue)
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: props.tabs.length - 1 }[e.key]
  if (next === undefined) return
  e.preventDefault()
  const target = props.tabs[(next + props.tabs.length) % props.tabs.length]!.id
  emit("update:modelValue", target)
  void nextTick(() => document.getElementById(`${props.idPrefix}-${target}`)?.focus())
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="label"
    class="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-background-card p-1.5 sm:inline-flex"
    @keydown="onKey"
  >
    <button
      v-for="t in tabs"
      :id="`${idPrefix}-${t.id}`"
      :key="t.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === t.id"
      :aria-controls="panelId"
      :tabindex="modelValue === t.id ? 0 : -1"
      class="tab-button inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors"
      :class="
        modelValue === t.id
          ? 'bg-accent/15 font-semibold text-accent shadow-[inset_0_0_0_1px_rgb(var(--color-accent)/0.45)]'
          : 'font-medium text-gray-400 hover:bg-background-hover hover:text-fg'
      "
      @click="emit('update:modelValue', t.id)"
    >
      {{ t.label }}
      <span v-if="t.flag" class="tab-flag h-2 w-2 rounded-full bg-warn" :title="t.flag" :aria-label="t.flag" />
    </button>
  </div>
</template>
