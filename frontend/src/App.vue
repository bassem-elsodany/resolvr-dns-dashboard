<script setup lang="ts">
import { useRoute } from "vue-router"
import AppShell from "./components/layout/AppShell.vue"

const route = useRoute()
</script>

<template>
  <div class="min-h-screen bg-background-canvas text-fg">
    <router-view v-if="route.name === 'login'" />
    <AppShell v-else />
  </div>
</template>
