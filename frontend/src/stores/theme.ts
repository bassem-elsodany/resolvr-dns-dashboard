import { defineStore } from "pinia"
import { ref } from "vue"

const STORAGE_KEY = "resolvr.theme"
type Mode = "light" | "dark"

function isMode(value: string | null): value is Mode {
  return value === "light" || value === "dark"
}

function applyToDocument(mode: Mode | null): void {
  if (mode) document.documentElement.setAttribute("data-theme", mode)
  else document.documentElement.removeAttribute("data-theme")
}

export const useThemeStore = defineStore("theme", () => {
  const stored = localStorage.getItem(STORAGE_KEY)
  const explicit = ref<Mode | null>(isMode(stored) ? stored : null)
  applyToDocument(explicit.value)

  function toggle(): void {
    const current =
      explicit.value ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    explicit.value = current === "dark" ? "light" : "dark"
    localStorage.setItem(STORAGE_KEY, explicit.value)
    applyToDocument(explicit.value)
  }

  return { explicit, toggle }
})
