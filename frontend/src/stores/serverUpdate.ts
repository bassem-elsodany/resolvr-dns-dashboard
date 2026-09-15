import { defineStore } from "pinia"
import { ref } from "vue"
import { checkForUpdate, type TechnitiumCredentials } from "../api/technitium"

// Shared between the sidebar's update badge and the Server Info page so
// both read one check instead of issuing their own /user/checkForUpdate
// calls independently.
export const useServerUpdateStore = defineStore("serverUpdate", () => {
  const updateAvailable = ref(false)
  const updateVersion = ref<string | null>(null)
  const updateTitle = ref<string | null>(null)

  async function check(credentials: TechnitiumCredentials): Promise<void> {
    try {
      const res = await checkForUpdate(credentials)
      updateAvailable.value = res.response.updateAvailable
      updateVersion.value = res.response.updateVersion ?? null
      updateTitle.value = res.response.updateTitle ?? null
    } catch {
      // Non-critical background check — leave state as-is on failure.
    }
  }

  return { updateAvailable, updateVersion, updateTitle, check }
})
