import { ref } from "vue"

export interface ToastState {
  text: string
  undo: (() => void) | null
}

// One message at the bottom of the page, optionally with an Undo that
// stays available for a few seconds. Used for actions that are cheap to
// reverse (unblocking a domain) so they need no confirmation dialog.
export function useUndoToast(durationMs = 7000) {
  const toast = ref<ToastState | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function show(text: string, undo: (() => void) | null = null): void {
    toast.value = { text, undo }
    if (timer) clearTimeout(timer)
    timer = setTimeout(dismiss, undo ? durationMs : Math.min(durationMs, 3500))
  }

  function dismiss(): void {
    toast.value = null
    if (timer) clearTimeout(timer)
    timer = null
  }

  function runUndo(): void {
    const fn = toast.value?.undo
    dismiss()
    fn?.()
  }

  return { toast, show, dismiss, runUndo }
}
