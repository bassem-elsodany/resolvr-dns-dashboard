<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import { useConnectionStore } from "../../stores/connection"
import { useThemeStore } from "../../stores/theme"
import { useServerUpdateStore } from "../../stores/serverUpdate"
import { useSidebarCountsStore } from "../../stores/sidebarCounts"
import { useTimeRangeStore } from "../../stores/timeRange"
import { useRefreshStore } from "../../stores/refresh"
import type { StatsDuration } from "../../api/technitium"
import { navSections } from "./navSections"
import NavIcon from "./NavIcon.vue"

const connection = useConnectionStore()
const theme = useThemeStore()
const serverUpdate = useServerUpdateStore()
const sidebarCounts = useSidebarCountsStore()
const timeRange = useTimeRangeStore()
const refresh = useRefreshStore()
const mobileOpen = ref(false)

const ranges: { key: StatsDuration; label: string }[] = [
  { key: "LastHour", label: "1H" },
  { key: "LastDay", label: "24H" },
  { key: "LastWeek", label: "7D" },
  { key: "LastMonth", label: "30D" },
  { key: "LastYear", label: "1Y" },
]

watch(
  () => connection.status,
  (status) => {
    if (status === "connected") {
      void serverUpdate.check(connection.credentials)
      void sidebarCounts.load(connection.credentials)
    }
  },
  { immediate: true },
)

// AppShell mounts once regardless of which route the app lands on
// (unlike ConnectView, which only mounts when the user is actually on
// /connect) — this is the one place that reliably re-validates a saved
// connection on every load, so the sidebar's status dot doesn't get
// stuck on "Not connected" just because the user landed on, say,
// /logs directly. Confirmed live: navigating straight to /logs with a
// valid saved token left the sidebar reading "Not connected" even
// while the page streamed real data, because only ConnectView ever
// called testConnection().
onMounted(() => {
  if (connection.isConfigured) void connection.testConnection()
})

// Matches the wireframe's sidebar count badges (Clients, Zones, Blocked
// Zones, Apps, Server Info). Returns null to hide the badge — e.g. no
// rate-limited clients, or a count that failed to load.
function navBadge(to: string): number | null {
  switch (to) {
    case "/clients":
      return sidebarCounts.rateLimitedClients > 0 ? sidebarCounts.rateLimitedClients : null
    case "/zones":
      return sidebarCounts.zonesTotal
    case "/blocked":
      return sidebarCounts.blockedZonesTotal
    case "/apps":
      return sidebarCounts.appsTotal
    case "/server":
      return serverUpdate.updateAvailable ? 1 : null
    default:
      return null
  }
}

// Clients' badge is an alert (rate-limited devices) so it reads in
// crit red, matching the wireframe; Server Info's is a warn-colored
// update notice; everything else is a neutral count.
function navBadgeClass(to: string): string {
  if (to === "/clients") return "text-crit"
  if (to === "/server") return "text-warn"
  return "text-gray-500"
}
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Backdrop for the off-canvas sidebar on small screens -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-10 bg-black/30 md:hidden"
      @click="mobileOpen = false"
    />

    <aside
      id="app-sidebar"
      class="fixed inset-y-0 left-0 z-20 flex w-60 flex-none flex-col gap-4 overflow-y-auto border-r border-border bg-background-sidebar p-3 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex items-center gap-2 px-1 py-1">
        <div
          class="flex h-6 w-6 flex-none items-center justify-center rounded-md"
          style="background: linear-gradient(155deg, rgb(var(--color-accent)) 0%, rgb(var(--color-cache)) 130%)"
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="white" stroke-width="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3Z" />
          </svg>
        </div>
        <div>
          <div class="text-sm font-bold tracking-tight">Resolvr</div>
          <div class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">DNS Monitor</div>
        </div>
      </div>

      <nav v-for="section in navSections" :key="section.label ?? 'top'" class="flex flex-col gap-0.5">
        <div
          v-if="section.label"
          class="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-gray-500"
        >
          {{ section.label }}
        </div>
        <router-link
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          class="nav-link flex min-h-[33px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-gray-400 transition-colors hover:bg-background-hover hover:text-fg"
          active-class="!bg-background-hover !text-fg"
          exact-active-class="!bg-background-hover !text-fg"
          @click="mobileOpen = false"
        >
          <NavIcon :name="item.icon" />
          {{ item.label }}
          <span
            v-if="navBadge(item.to) !== null"
            :id="item.to === '/server' ? 'server-update-badge' : undefined"
            class="ml-auto text-[10.5px] font-bold tabular-nums"
            :class="navBadgeClass(item.to)"
            :title="item.to === '/server' ? (serverUpdate.updateTitle ?? 'Update available') : undefined"
          >
            {{ navBadge(item.to) }}
          </span>
        </router-link>
      </nav>

      <div class="mt-auto flex flex-col gap-2">
        <div class="flex flex-col gap-1 rounded-lg border border-border bg-background-card px-2.5 py-2">
          <div class="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span
              class="h-1.5 w-1.5 flex-none rounded-full"
              :class="connection.status === 'connected' ? 'bg-ok' : 'bg-gray-500'"
            />
            {{ connection.status === "connected" ? "Connected" : "Not connected" }}
          </div>
          <div v-if="connection.status === 'connected'" class="text-xs font-semibold">
            {{ connection.serverDomain }}
          </div>
          <div v-if="connection.status === 'connected'" class="font-mono text-[10.5px] text-gray-500">
            v{{ connection.serverVersion }}
          </div>
        </div>
        <router-link
          to="/connect"
          class="nav-link flex min-h-[33px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-gray-400 hover:bg-background-hover hover:text-fg"
          active-class="!bg-background-hover !text-fg"
          @click="mobileOpen = false"
        >
          <NavIcon name="connect" />
          Connection Settings
        </router-link>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background-canvas/90 px-5 py-3 backdrop-blur"
      >
        <button
          id="mobile-nav-toggle"
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border md:hidden"
          @click="mobileOpen = !mobileOpen"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div class="ml-auto flex flex-wrap items-center gap-2">
          <div id="topbar-range-seg" class="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background-hover p-0.5">
            <button
              v-for="range in ranges"
              :key="range.key"
              type="button"
              class="rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-gray-500"
              :class="timeRange.selected === range.key ? 'bg-background-card text-fg shadow-sm' : ''"
              @click="timeRange.set(range.key)"
            >
              {{ range.label }}
            </button>
          </div>
          <button
            id="topbar-refresh"
            type="button"
            title="Refresh now"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-gray-500 hover:bg-background-hover hover:text-fg"
            @click="refresh.trigger()"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M20 11A8 8 0 1 0 18.7 16M20 5v6h-6" />
            </svg>
          </button>
          <button
            id="theme-toggle"
            type="button"
            title="Toggle theme"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-gray-500 hover:bg-background-hover hover:text-fg"
            @click="theme.toggle()"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="4.2" />
              <path
                d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
              />
            </svg>
          </button>
        </div>
      </header>

      <div class="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
        <router-view />
      </div>
    </div>
  </div>
</template>
