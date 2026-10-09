import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"

// Which tab is open lives in the URL (?tab=), so a refresh or a shared link
// lands on the same one, and falls back to the tab last used in this
// browser, then to the first. Shared by every page that has tabs.
export function useRouteTab<T extends string>(ids: readonly T[], storageKey: string, fallback: T) {
  const route = useRoute()
  const router = useRouter()

  function stored(): T | null {
    try {
      const v = localStorage.getItem(storageKey)
      return ids.find((id) => id === v) ?? null
    } catch {
      return null
    }
  }

  const tab = computed<T>(() => ids.find((id) => id === route.query.tab) ?? stored() ?? fallback)

  function setTab(id: T): void {
    try {
      localStorage.setItem(storageKey, id)
    } catch {
      // Not remembered; the URL still carries the choice.
    }
    void router.replace({ query: { ...route.query, tab: id } })
  }

  return { tab, setTab }
}
