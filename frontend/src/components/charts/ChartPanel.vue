<script setup lang="ts">
defineProps<{ title: string; hint?: string }>()
</script>

<template>
  <section class="min-w-0 rounded-lg border border-border bg-background-card px-4 py-3.5">
    <h2 class="text-[13.5px] font-semibold">{{ title }}</h2>
    <p v-if="hint" class="mb-2.5 mt-0.5 text-[11.5px] text-gray-500">{{ hint }}</p>
    <div v-else class="mb-2.5" />
    <slot />
  </section>
</template>
