import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"
import LoginView from "./LoginView.vue"

vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, login: vi.fn() }
})

import { login, AppApiError } from "../../api/app"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", component: LoginView },
      { path: "/", component: { template: "<div>home</div>" } },
      { path: "/zones", component: { template: "<div>zones</div>" } },
    ],
  })
}

describe("LoginView", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(login).mockReset()
  })

  it("logs in and redirects to / by default", async () => {
    vi.mocked(login).mockResolvedValue({ id: 1, username: "admin", role: "admin" })
    const router = makeRouter()
    await router.push("/login")
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.get("#login-username").setValue("admin")
    await wrapper.get("#login-password").setValue("adminpass1")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(login).toHaveBeenCalledWith("admin", "adminpass1")
    expect(router.currentRoute.value.path).toBe("/")
  })

  it("redirects to the originally requested page after login", async () => {
    vi.mocked(login).mockResolvedValue({ id: 2, username: "reader", role: "viewer" })
    const router = makeRouter()
    await router.push("/login?redirect=/zones")
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.get("#login-username").setValue("reader")
    await wrapper.get("#login-password").setValue("readerpass1")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(router.currentRoute.value.path).toBe("/zones")
  })

  it("shows a readable inline error, not a raw stack trace, on invalid credentials", async () => {
    vi.mocked(login).mockRejectedValue(new AppApiError("Invalid username or password", 401))
    const router = makeRouter()
    await router.push("/login")
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.get("#login-username").setValue("admin")
    await wrapper.get("#login-password").setValue("wrong-password")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find("#login-error").text()).toBe("Invalid username or password")
    expect(router.currentRoute.value.path).toBe("/login")
  })
})
