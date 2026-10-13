// Which Technitium server the dashboard is looking at. The backend can hold
// several (the primary connection plus any added under Connection Settings);
// every API call names one with this header, and leaving it out means the
// primary, so a single-server install behaves exactly as before.
//
// The choice is per browser, kept in localStorage, and 0 is the primary.
export const SERVER_HEADER = "X-Resolvr-Server"

const STORAGE_KEY = "resolvr.activeServer"

let active = readStored()

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : 0
  } catch {
    return 0
  }
}

export function getActiveServerId(): number {
  return active
}

export function setActiveServerId(id: number): void {
  active = id
  try {
    if (id === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(id))
  } catch {
    // Private mode or blocked storage: the choice just lasts until reload.
  }
}

// Headers to add to a backend request; empty for the primary.
export function serverHeaders(): Record<string, string> {
  return active === 0 ? {} : { [SERVER_HEADER]: String(active) }
}
