import type { DownloadedFile } from "../api/technitium"

// The sandbox that hosted this app's design phase blocks script-driven
// downloads, but a real browser allows the standard object-URL pattern —
// this only runs in the built app, never in a preview context.
export function triggerDownload(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement("a")
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
