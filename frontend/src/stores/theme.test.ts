import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useThemeStore } from "./theme"

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stamps no data-theme attribute when no preference was ever saved", () => {
    useThemeStore()

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("restores a previously saved theme and stamps the attribute on creation", () => {
    localStorage.setItem("resolvr.theme", "dark")

    useThemeStore()

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("toggle flips from light to dark and persists the choice", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    const store = useThemeStore()

    store.toggle()

    expect(store.explicit).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(localStorage.getItem("resolvr.theme")).toBe("dark")
  })

  it("toggle flips from dark back to light", () => {
    localStorage.setItem("resolvr.theme", "dark")
    const store = useThemeStore()

    store.toggle()

    expect(store.explicit).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
  })

  it("first toggle with no saved preference flips away from the OS preference", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true })) // OS is dark
    const store = useThemeStore()

    store.toggle()

    expect(store.explicit).toBe("light")
  })
})
