import { defineStore } from "pinia"
import { ref } from "vue"
import type { StatsDuration } from "../api/technitium"

// The wireframe puts one time-range segmented control in the global
// topbar (1H/24H/7D/30D/1Y), not a separate copy on every page that
// uses it — Overview and Clients both read this shared selection
// instead of keeping their own local state.
export const useTimeRangeStore = defineStore("timeRange", () => {
  const selected = ref<StatsDuration>("LastHour")

  function set(value: StatsDuration): void {
    selected.value = value
  }

  return { selected, set }
})
