import { describe, it, expect, beforeEach } from "vitest"
import { getActiveServerId, setActiveServerId, serverHeaders, SERVER_HEADER } from "./activeServer"

describe("active server", () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveServerId(0)
  })

  it("sends no header for the primary server", () => {
    expect(getActiveServerId()).toBe(0)
    expect(serverHeaders()).toEqual({})
  })

  it("names the chosen server in the header and remembers it", () => {
    setActiveServerId(3)

    expect(serverHeaders()).toEqual({ [SERVER_HEADER]: "3" })
    expect(localStorage.getItem("resolvr.activeServer")).toBe("3")
  })

  it("forgets the choice when it goes back to the primary", () => {
    setActiveServerId(3)
    setActiveServerId(0)

    expect(localStorage.getItem("resolvr.activeServer")).toBeNull()
    expect(serverHeaders()).toEqual({})
  })
})
