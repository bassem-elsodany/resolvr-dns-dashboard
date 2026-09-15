import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import UsersView from "./UsersView.vue"
import { useAuthStore } from "../../stores/auth"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, listUsers: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(), changeUserPassword: vi.fn() }
})

import { listUsers, createUser, deleteUser, changeUserPassword, AppApiError } from "../../api/app"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const sampleUsers = [
  { id: 1, username: "admin", role: "admin" as const, createdAt: "2026-09-01T00:00:00Z" },
  { id: 2, username: "reader", role: "viewer" as const, createdAt: "2026-09-05T00:00:00Z" },
]

describe("UsersView", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, username: "admin", role: "admin" }
    vi.mocked(listUsers).mockReset().mockResolvedValue({ users: sampleUsers })
    vi.mocked(createUser).mockReset()
    vi.mocked(deleteUser).mockReset()
    vi.mocked(changeUserPassword).mockReset()
  })

  it("lists existing users with their role", async () => {
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(wrapper.text()).toContain("admin")
    expect(wrapper.text()).toContain("reader")
    expect(wrapper.text()).toContain("Admin")
    expect(wrapper.text()).toContain("Viewer")
  })

  it("marks the currently signed-in user", async () => {
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(wrapper.text()).toContain("(you)")
  })

  it("adds a new user and refreshes the list", async () => {
    vi.mocked(createUser).mockResolvedValue({
      id: 3,
      username: "newviewer",
      role: "viewer",
      createdAt: "2026-09-15T00:00:00Z",
    })
    vi.mocked(listUsers).mockResolvedValueOnce({ users: sampleUsers }).mockResolvedValueOnce({
      users: [...sampleUsers, { id: 3, username: "newviewer", role: "viewer" as const, createdAt: "2026-09-15T00:00:00Z" }],
    })
    const wrapper = mount(UsersView)
    await flushPromises()

    await wrapper.get("#new-username").setValue("newviewer")
    await wrapper.get("#new-password").setValue("viewerpass1")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(createUser).toHaveBeenCalledWith("newviewer", "viewerpass1", "viewer")
    expect(wrapper.text()).toContain("newviewer")
  })

  it("shows a readable error, not a raw stack trace, when adding a duplicate username fails", async () => {
    vi.mocked(createUser).mockRejectedValue(new AppApiError('Username "admin" is already taken', 409))
    const wrapper = mount(UsersView)
    await flushPromises()

    await wrapper.get("#new-username").setValue("admin")
    await wrapper.get("#new-password").setValue("somethingelse1")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#add-user-error").text()).toBe('Username "admin" is already taken')
  })

  it("requires a two-step confirmation before deleting a user", async () => {
    vi.mocked(deleteUser).mockResolvedValue({ status: "ok" })
    const wrapper = mount(UsersView)
    await flushPromises()

    const readerRow = wrapper.findAll("tbody tr").find((r) => r.text().includes("reader"))!
    await readerRow.get("button.text-crit").trigger("click") // "Delete"
    expect(deleteUser).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("Delete this user?")

    await readerRow.get("button.text-crit").trigger("click") // "Confirm"
    await flushPromises()

    expect(deleteUser).toHaveBeenCalledWith(2)
  })

  it("changes a user's password via the inline form", async () => {
    vi.mocked(changeUserPassword).mockResolvedValue({ status: "ok" })
    const wrapper = mount(UsersView)
    await flushPromises()

    const readerRow = wrapper.findAll("tbody tr").find((r) => r.text().includes("reader"))!
    await readerRow.get("button.text-accent").trigger("click") // "Change password"
    await readerRow.get("input[type=password]").setValue("brand-new-pass")
    await readerRow.get("button.text-accent").trigger("click") // "Save"
    await flushPromises()

    expect(changeUserPassword).toHaveBeenCalledWith(2, "brand-new-pass")
  })
})
