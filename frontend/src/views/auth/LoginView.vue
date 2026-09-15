<script setup lang="ts">
import { ref } from "vue"
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
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
    <div class="mb-6 flex items-center gap-2">
      <div
        class="flex h-7 w-7 flex-none items-center justify-center rounded-md"
        style="background: linear-gradient(155deg, rgb(var(--color-accent)) 0%, rgb(var(--color-cache)) 130%)"
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="white" stroke-width="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3Z" />
        </svg>
      </div>
      <div>
        <div class="text-sm font-bold tracking-tight">Resolvr</div>
        <div class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">DNS Monitor</div>
      </div>
    </div>

    <h1 class="text-xl font-semibold tracking-tight">Sign in</h1>

    <form class="mt-6 flex flex-col gap-4" @submit.prevent="onSubmit">
      <div class="flex flex-col gap-1.5">
        <label for="login-username" class="text-xs font-semibold text-gray-500">Username</label>
        <input
          id="login-username"
          v-model="username"
          type="text"
          autocomplete="username"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="login-password" class="text-xs font-semibold text-gray-500">Password</label>
        <input
          id="login-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="w-full rounded-md border border-border bg-background-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <button
        id="login-submit"
        type="submit"
        :disabled="submitting"
        class="inline-flex items-center justify-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {{ submitting ? "Signing in…" : "Sign in" }}
      </button>

      <p v-if="auth.error" id="login-error" class="text-sm text-crit">{{ auth.error }}</p>
    </form>
  </main>
</template>
