<script setup lang="ts">
import type { NavIconName } from "./navSections"

// Exact icon paths from the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM) — one per nav
// item, keyed by the same name used in navSections.ts.
defineProps<{ name: NavIconName }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4 flex-none">
    <template v-if="name === 'overview'">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </template>
    <template v-else-if="name === 'clients'">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <circle cx="17.5" cy="8.5" r="2.4" />
      <path d="M15.7 13.6c2.4.3 4.3 2.2 4.3 5.4" />
    </template>
    <template v-else-if="name === 'logs'">
      <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
    </template>
    <template v-else-if="name === 'cache'">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'zones'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5C9.8 18.2 8.6 15.2 8.6 12S9.8 5.8 12 3.5Z" />
    </template>
    <template v-else-if="name === 'allowed'">
      <path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6l7-2.5Z" stroke-linejoin="round" />
      <path d="m9 12 2 2 4-4" />
    </template>
    <template v-else-if="name === 'blocked'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.5 6.5 11 11" />
    </template>
    <template v-else-if="name === 'dhcp'">
      <rect x="3.5" y="7" width="17" height="11" rx="1.5" />
      <path d="M8 7V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V7M7.5 12h.01M7.5 15h.01" />
    </template>
    <template v-else-if="name === 'resolver'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8" />
    </template>
    <template v-else-if="name === 'apps'">
      <path
        d="M13 3.5v3.7a1.8 1.8 0 0 0 2.6 1.6l3.3-1.6.9 1.9-3.3 1.6a1.8 1.8 0 0 0 0 3.2l3.3 1.6-.9 1.9-3.3-1.6A1.8 1.8 0 0 0 13 17.4v3.1H9v-3.1a1.8 1.8 0 0 0-2.6-1.6l-2.3 1.1-.9-1.9 2.3-1.1a1.8 1.8 0 0 0 0-3.2L3.2 9.6l.9-1.9 2.3 1.1A1.8 1.8 0 0 0 9 7.2V3.5h4Z"
        stroke-linejoin="round"
      />
    </template>
    <template v-else-if="name === 'server'">
      <rect x="3.5" y="4" width="17" height="6.5" rx="1.5" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" />
      <path d="M7 7.25h.01M7 16.75h.01" />
    </template>
    <template v-else-if="name === 'sessions'">
      <rect x="3.5" y="5" width="17" height="12" rx="1.8" />
      <path d="M3.5 9h17M7 13h4" />
    </template>
    <template v-else-if="name === 'connect'">
      <path d="M9 3v4M15 3v4M6 8h12l-1 4.5a5 5 0 0 1-5 4V20M9 20h6" />
    </template>
    <template v-else-if="name === 'users'">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 4.2a3.2 3.2 0 0 1 0 6.2M18 13.7c2 .6 3 2.3 3 5.3" />
    </template>
  </svg>
</template>
