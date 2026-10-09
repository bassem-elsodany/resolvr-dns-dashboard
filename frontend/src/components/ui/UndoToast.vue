<script setup lang="ts">
import type { ToastState } from "../../composables/useUndoToast"

defineProps<{ toast: ToastState | null }>()
defineEmits<{ (e: "undo"): void }>()
</script>

<template>
  <div
    v-if="toast"
    id="undo-toast"
    role="status"
    aria-live="polite"
    class="fixed bottom-4 left-4 z-40 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg bg-fg px-3.5 py-2.5 text-[13px] text-background-canvas shadow-lg"
  >
    <span>{{ toast.text }}</span>
    <button v-if="toast.undo" id="undo-toast-undo" type="button" class="font-bold text-accent" @click="$emit('undo')">Undo</button>
  </div>
</template>
