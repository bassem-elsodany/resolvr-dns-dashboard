<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useAuthStore } from "../../stores/auth"

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref("")
const password = ref("")
const submitting = ref(false)

async function onSubmit(): Promise<void> {
  submitting.value = true
  const ok = await auth.login(username.value, password.value)
  submitting.value = false
  if (ok) {
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/"
    void router.push(redirect)
  }
}

interface PromoScene {
  id: string
  eyebrow: string
  title: string
  description: string
}

const scenes: PromoScene[] = [
  {
    id: "live",
    eyebrow: "Live resolver activity",
    title: "See every query the moment it happens.",
    description: "Clients, top domains, blocked requests, and cache — one dashboard, no console-hopping.",
  },
  {
    id: "blocking",
    eyebrow: "Blocking, understood",
    title: "Browse block lists as an actual tree.",
    description: "Expand any zone to see what it really blocks underneath — not a flat, misleading count.",
  },
  {
    id: "roles",
    eyebrow: "Built for a team",
    title: "Read access for everyone, admin for a trusted few.",
    description: "Viewers get every monitoring page. A short, explicit list of actions stays admin-only.",
  },
]

const SCENE_MS = 7000
const sceneIndex = ref(0)
const activeScene = computed(() => scenes[sceneIndex.value]!)
let sceneTimer: ReturnType<typeof setInterval> | null = null

function goToScene(index: number): void {
  sceneIndex.value = ((index % scenes.length) + scenes.length) % scenes.length
  restartSceneTimer()
}

function restartSceneTimer(): void {
  if (sceneTimer) clearInterval(sceneTimer)
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
  sceneTimer = setInterval(() => {
    sceneIndex.value = (sceneIndex.value + 1) % scenes.length
  }, SCENE_MS)
}

onMounted(restartSceneTimer)
onUnmounted(() => {
  if (sceneTimer) clearInterval(sceneTimer)
})
</script>

<template>
  <div class="flex min-h-screen bg-background-canvas text-fg">
    <!-- Brand panel — hidden below lg, matches the Cloudflare-style split login pattern -->
    <div
      class="relative hidden flex-col overflow-hidden p-10 text-white lg:flex lg:w-1/2 xl:p-16"
      style="background: linear-gradient(155deg, rgb(var(--color-accent)) 0%, rgb(var(--color-cache)) 130%)"
    >
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 opacity-[0.15]">
        <svg viewBox="0 0 400 400" class="h-full w-full">
          <circle cx="80" cy="60" r="70" fill="none" stroke="white" stroke-width="1.5" />
          <circle cx="80" cy="60" r="130" fill="none" stroke="white" stroke-width="1.5" />
          <circle cx="340" cy="360" r="90" fill="none" stroke="white" stroke-width="1.5" />
          <circle cx="340" cy="360" r="150" fill="none" stroke="white" stroke-width="1.5" />
        </svg>
      </div>

      <div class="relative z-10 flex items-center gap-2.5">
        <div class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-white/15">
          <svg viewBox="0 0 24 24" class="h-4.5 w-4.5" fill="none" stroke="white" stroke-width="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3Z" />
          </svg>
        </div>
        <span class="text-lg font-semibold tracking-tight">Resolvr</span>
      </div>

      <div class="relative z-10 flex flex-1 flex-col justify-center">
        <div class="relative min-h-[13rem] w-full max-w-sm">
          <Transition name="login-scene" mode="out-in">
            <div :key="activeScene.id" class="flex flex-col items-start gap-3.5">
              <span class="font-mono text-xs font-semibold uppercase tracking-wide text-white/85">{{
                activeScene.eyebrow
              }}</span>
              <h2 class="text-balance text-2xl font-semibold leading-snug xl:text-3xl">{{ activeScene.title }}</h2>
              <p class="text-[13.5px] leading-relaxed text-white/90">{{ activeScene.description }}</p>
            </div>
          </Transition>
        </div>
      </div>

      <div class="relative z-10 flex items-center gap-2" role="tablist" aria-label="Promo scenes">
        <button
          v-for="(scene, index) in scenes"
          :key="scene.id"
          type="button"
          role="tab"
          class="h-1.5 w-1.5 rounded-full transition-colors"
          :class="index === sceneIndex ? 'bg-white' : 'bg-white/35 hover:bg-white/55'"
          :aria-selected="index === sceneIndex"
          :aria-label="scene.eyebrow"
          @click="goToScene(index)"
        />
      </div>
    </div>

    <!-- Sign-in panel -->
    <div class="flex flex-1 items-center justify-center px-6 py-16">
      <div class="w-full max-w-sm">
        <div class="mb-6 flex items-center justify-center gap-2 lg:hidden">
          <div
            class="flex h-7 w-7 flex-none items-center justify-center rounded-md"
            style="background: linear-gradient(155deg, rgb(var(--color-accent)) 0%, rgb(var(--color-cache)) 130%)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="white" stroke-width="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3Z" />
            </svg>
          </div>
          <span class="text-sm font-bold tracking-tight">Resolvr</span>
        </div>

        <div class="rounded-xl border border-border bg-background-card p-8 shadow-sm sm:p-10">
          <h1 class="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p class="mt-2 text-sm text-gray-500">Sign in to monitor your Technitium DNS server.</p>

          <form class="mt-7 flex flex-col gap-4" @submit.prevent="onSubmit">
            <div class="flex flex-col gap-1.5">
              <label for="login-username" class="text-xs font-semibold text-gray-500">Username</label>
              <input
                id="login-username"
                v-model="username"
                type="text"
                autocomplete="username"
                class="w-full rounded-md border border-border bg-background-card px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="login-password" class="text-xs font-semibold text-gray-500">Password</label>
              <input
                id="login-password"
                v-model="password"
                type="password"
                autocomplete="current-password"
                class="w-full rounded-md border border-border bg-background-card px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <p v-if="auth.error" id="login-error" class="rounded-lg border border-crit/25 bg-crit/10 px-3 py-2 text-sm text-crit">
              {{ auth.error }}
            </p>

            <button
              id="login-submit"
              type="submit"
              :disabled="submitting"
              class="mt-1 inline-flex items-center justify-center rounded-md bg-accent px-3.5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {{ submitting ? "Signing in…" : "Sign in" }}
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-scene-enter-active,
.login-scene-leave-active {
  transition:
    opacity 280ms ease,
    transform 280ms ease;
}
.login-scene-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.login-scene-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
