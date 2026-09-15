<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
defineEmits<{ (e: "update:modelValue", value: boolean): void }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="flex items-center gap-1.5 rounded-md border border-border bg-background-card px-2.5 py-1.5"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="h-1.5 w-1.5 flex-none rounded-full" :class="modelValue ? 'bg-ok' : 'bg-gray-500'" />
    <span class="text-[11.5px] font-semibold text-gray-500">Live</span>
    <span class="relative inline-block h-4 w-7 flex-none rounded-full transition-colors" :class="modelValue ? 'bg-ok' : 'bg-border'">
      <span
        class="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform"
        :class="modelValue ? 'translate-x-3' : 'translate-x-0'"
      />
    </span>
  </button>
</template>
