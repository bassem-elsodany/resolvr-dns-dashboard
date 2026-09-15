import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { login as apiLogin, logout as apiLogout, fetchMe, AppApiError, type CurrentUser } from "../api/app"

export const useAuthStore = defineStore("auth", () => {
  const user = ref<CurrentUser | null>(null)
  // Distinguishes "haven't checked yet" from "checked, not logged in" —
  // the router guard needs this to avoid bouncing to /login before the
  // initial session check (fetchMe on app boot) has even run.
  const checked = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === "admin")

  async function checkSession(): Promise<void> {
    try {
      user.value = await fetchMe()
    } catch {
      user.value = null
    } finally {
      checked.value = true
    }
  }

  async function login(username: string, password: string): Promise<boolean> {
    error.value = null
    try {
      user.value = await apiLogin(username, password)
      checked.value = true
      return true
    } catch (err) {
      error.value = err instanceof AppApiError ? err.message : "Could not log in."
      return false
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiLogout()
    } finally {
      user.value = null
    }
  }

  return { user, checked, error, isAuthenticated, isAdmin, checkSession, login, logout }
})
