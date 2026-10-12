import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { login as apiLogin, logout as apiLogout, fetchMe, AppApiError, type CurrentUser } from "../api/app"

// The sign-in call can succeed while the browser still does not send the
// session cookie on the next request (a `Secure` cookie over plain http://, or
// a page and an API on different hosts). Say so, instead of leaving a page
// that fails later with a bare "Not authenticated".
const SESSION_NOT_KEPT =
  "Signed in, but your browser is not sending the session cookie, so you are not signed in. " +
  "If COOKIE_SECURE=true is set on the server, open Resolvr over HTTPS (or unset it). If BACKEND_URL is set, " +
  "open Resolvr by the same address as the backend, not a different host name or IP."

export const useAuthStore = defineStore("auth", () => {
  const user = ref<CurrentUser | null>(null)
  // Distinguishes "haven't checked yet" from "checked, not logged in" —
  // the router guard needs this to avoid bouncing to /login before the
  // initial session check (fetchMe on app boot) has even run.
  const checked = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === "admin")
  // Signed in by Home Assistant rather than with a Resolvr account.
  const external = computed(() => user.value?.external === true)

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
      const signedIn = await apiLogin(username, password)
      // Ask who we are on the very next request, the way every page will.
      try {
        user.value = await fetchMe()
      } catch (err) {
        if (err instanceof AppApiError && err.status === 401) {
          user.value = null
          error.value = SESSION_NOT_KEPT
          return false
        }
        user.value = signedIn
      }
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

  return { user, checked, error, isAuthenticated, isAdmin, external, checkSession, login, logout }
})
