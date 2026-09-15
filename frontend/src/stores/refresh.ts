import { defineStore } from "pinia"
import { ref } from "vue"

// The wireframe's topbar refresh button is global — whichever page is
// currently mounted re-fetches its own data. Each view watches `tick`
// and reloads when it changes; the button itself just increments it.
export const useRefreshStore = defineStore("refresh", () => {
  const tick = ref(0)

  function trigger(): void {
    tick.value++
  }

  return { tick, trigger }
})
