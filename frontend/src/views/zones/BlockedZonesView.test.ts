import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createRouter, createMemoryHistory } from "vue-router"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listBlockedZones: vi.fn(), exportBlockedZones: vi.fn(), getSettings: vi.fn(), getDashboardStats: vi.fn(), resolveDnsQuery: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, updateBlockListUrls: vi.fn(), blockDomain: vi.fn(), unblockDomain: vi.fn(), forceUpdateBlockLists: vi.fn() }
})

import { listBlockedZones, exportBlockedZones, getSettings, getDashboardStats, resolveDnsQuery, TechnitiumApiError } from "../../api/technitium"
import { updateBlockListUrls, blockDomain, unblockDomain, forceUpdateBlockLists, AppApiError } from "../../api/app"
import { triggerDownload } from "../../lib/download"
import { clearCache } from "../../lib/charts"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useRefreshStore } from "../../stores/refresh"
import BlockedZonesView from "./BlockedZonesView.vue"

const HOUR = 3600_000
// Fixed per test, so "the next update has not moved" is really the same string.
let NEXT = ""
const LINES = ["# General threat intel", "https://a.example.com/t.txt", "# Ads and trackers", "https://b.example.org/ads.txt"]

function settings(over: Record<string, unknown> = {}) {
  return {
    response: {
      enableBlocking: true,
      blockingType: "NxDomain",
      blockListUrls: LINES,
      blockListUpdateIntervalHours: 12,
      blockListNextUpdatedOn: NEXT,
      ...over,
    },
  } as never
}

const statsWith = (n: number) => ({ response: { stats: { blockListZones: n } } }) as never

// com -> example.com (blocked); net -> ads.example.net (blocked)
const TREE: Record<string, { zones: string[]; own: boolean }> = {
  "": { zones: ["com", "net"], own: false },
  com: { zones: ["example.com"], own: false },
  "example.com": { zones: [], own: true },
  net: { zones: ["ads.example.net"], own: false },
  "ads.example.net": { zones: [], own: true },
}

function mockServer() {
  vi.mocked(getSettings).mockResolvedValue(settings())
  vi.mocked(getDashboardStats).mockResolvedValue(statsWith(1203411))
  vi.mocked(listBlockedZones).mockImplementation((async (_c: unknown, d = "") => {
    const n = TREE[d as string]!
    return { response: { domain: d, zones: n.zones, records: n.own ? [{ name: d, type: "A", ttl: 1, rData: {} }] : [] } }
  }) as never)
  vi.mocked(updateBlockListUrls).mockResolvedValue({ status: "ok" })
  vi.mocked(blockDomain).mockResolvedValue({ status: "ok" })
  vi.mocked(unblockDomain).mockResolvedValue({ status: "ok" })
  vi.mocked(forceUpdateBlockLists).mockResolvedValue({ status: "ok" })
}

async function makeRouter(path = "/blocked") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/blocked", component: BlockedZonesView },
      { path: "/connect", component: { template: "<div />" } },
    ],
  })
  await router.push(path)
  return router
}

async function mountPage(role: "admin" | "viewer" = "admin", tab?: "feeds" | "domains" | "check") {
  const router = await makeRouter(tab ? `/blocked?tab=${tab}` : "/blocked")
  const wrapper = mount(BlockedZonesView, { global: { plugins: [router] }, attachTo: document.body })
  useAuthStore().user = { id: 1, username: role, role }
  useConnectionStore().isConfigured = true
  await flushPromises()
  return wrapper
}

describe("BlockedZonesView", () => {
  beforeEach(() => {
    NEXT = new Date(Date.now() + 4 * HOUR).toISOString()
    clearCache()
    localStorage.clear()
    setActivePinia(createPinia())
    for (const f of [listBlockedZones, exportBlockedZones, getSettings, getDashboardStats, resolveDnsQuery, updateBlockListUrls, blockDomain, unblockDomain, forceUpdateBlockLists, triggerDownload]) {
      (f as unknown as { mockReset: () => void }).mockReset()
    }
    mockServer()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("prompts to connect when no server is configured", async () => {
    const wrapper = mount(BlockedZonesView, { global: { plugins: [await makeRouter()], stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain("Connect to a Technitium server")
    expect(getSettings).not.toHaveBeenCalled()
  })

  describe("tabs", () => {
    it("keeps the status card on top and opens on Feeds", async () => {
      const w = await mountPage()
      expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual(["Feeds", "Your domains", "Check a domain"])
      expect(w.get("#blocked-tab-feeds").attributes("aria-selected")).toBe("true")
      expect(w.find("#status-total").exists()).toBe(true)
      expect(w.find("#new-feed-url").isVisible()).toBe(true)
      expect(w.find("#new-blocked-domain").exists()).toBe(false)
      expect(w.find("#check-domain").exists()).toBe(false)
    })

    it("shows only the chosen section, records it in the URL, and keeps the status card", async () => {
      const w = await mountPage()
      await w.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      expect(w.vm.$route.query.tab).toBe("domains")
      expect(w.find("#new-blocked-domain").exists()).toBe(true)
      expect(w.get("#new-feed-url").isVisible()).toBe(false)
      expect(w.find("#status-total").exists()).toBe(true)
    })

    it("opens on the tab named in the URL, and remembers the last one used", async () => {
      const named = await mountPage("admin", "check")
      expect(named.find("#check-domain").exists()).toBe(true)
      named.unmount()

      const first = await mountPage()
      await first.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      first.unmount()

      const w = await mountPage()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
    })

    it("only reads the blocked-domain tree once the Your domains tab is opened", async () => {
      const w = await mountPage()
      expect(listBlockedZones).not.toHaveBeenCalled()
      await w.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      expect(listBlockedZones).toHaveBeenCalled()
    })

    it("flags the Feeds tab while edits are unsaved, and keeps them when you look at another tab", async () => {
      const w = await mountPage()
      expect(w.find(".tab-flag").exists()).toBe(false)
      await w.findAll(".feed-remove")[0]!.trigger("click")
      expect(w.get("#blocked-tab-feeds .tab-flag").attributes("title")).toBe("Unsaved changes")

      await w.get("#blocked-tab-domains").trigger("click")
      await flushPromises()
      expect(w.find("#blocked-tab-feeds .tab-flag").exists()).toBe(true)
      await w.get("#blocked-tab-feeds").trigger("click")
      await flushPromises()
      expect(w.findAll(".feed-row")[0]!.text()).toContain("Removing")
    })

    it("moves between tabs with the arrow keys", async () => {
      const w = await mountPage()
      await w.get("#blocked-tab-feeds").trigger("keydown", { key: "ArrowRight" })
      await flushPromises()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
      await w.get("#blocked-tab-domains").trigger("keydown", { key: "End" })
      await flushPromises()
      expect(w.get("#blocked-tab-check").attributes("aria-selected")).toBe("true")
    })
  })

  describe("status", () => {
    it("shows blocking state, domain total, and last and next update", async () => {
      const w = await mountPage()
      expect(w.get("#blocking-pill").text()).toBe("Blocking on")
      expect(w.text()).toContain("Blocked names answer NxDomain")
      expect(w.get("#status-total").text()).toBe("1,203,411")
      expect(w.get("#status-last").text()).toBe("8 h ago") // next in 4 h, every 12 h
      expect(w.get("#status-next").text()).toBe("in 4 h")
      expect(w.text()).toContain("Every 12 hours")
    })

    it("says when blocking is off, and when an update is overdue", async () => {
      vi.mocked(getSettings).mockResolvedValue(settings({ enableBlocking: false, blockListNextUpdatedOn: new Date(Date.now() - HOUR).toISOString() }))
      const w = await mountPage()
      expect(w.get("#blocking-pill").text()).toBe("Blocking off")
      expect(w.get("#status-next").text()).toBe("Overdue")
    })

    it("starts a history on the first visit, and shows the change once there is an earlier reading", async () => {
      const first = await mountPage()
      expect(first.find("#status-change").exists()).toBe(false)
      expect(first.find("#history-empty").exists()).toBe(true)
      first.unmount()

      localStorage.setItem("resolvr.blockListHistory", JSON.stringify([{ t: Date.now() - 24 * HOUR, total: 1000000 }]))
      clearCache()
      const w = await mountPage()
      expect(w.get("#status-change").text()).toContain("+203,411 since the previous refresh")
      expect(w.findAll(".history-row")).toHaveLength(2)
    })

    it("shows a readable error, not a raw stack trace, when settings fail to load", async () => {
      vi.mocked(getSettings).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 401))
      const w = await mountPage()
      expect(w.get("#settings-error").text()).toBe("Invalid token or session expired.")
    })

    it("still shows everything else when the domain total cannot be loaded", async () => {
      vi.mocked(getDashboardStats).mockRejectedValue(new Error("boom"))
      const w = await mountPage()
      expect(w.get("#status-total").text()).toBe("–")
      expect(w.find("#settings-error").exists()).toBe(false)
    })
  })

  describe("Update now", () => {
    it("hides the button from a viewer", async () => {
      const w = await mountPage("viewer")
      expect(w.find("#update-now").exists()).toBe(false)
      expect(w.text()).toContain("Only admins can start an update")
    })

    it("starts the update, watches for the server to finish, and reports what changed", async () => {
      const w = await mountPage()
      vi.useFakeTimers()
      // The first check still shows the old next-update time, the second a new one.
      vi.mocked(getSettings)
        .mockResolvedValueOnce(settings())
        .mockResolvedValue(settings({ blockListNextUpdatedOn: new Date(Date.parse(NEXT) + 8 * HOUR).toISOString() }))
      vi.mocked(getDashboardStats).mockResolvedValue(statsWith(1204615))

      await w.get("#update-now").trigger("click")
      await vi.advanceTimersByTimeAsync(0)
      expect(forceUpdateBlockLists).toHaveBeenCalledTimes(1)
      expect(w.get("#update-now").attributes("disabled")).toBeDefined()
      expect(w.find("#update-progress").exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(3000)
      expect(w.find("#update-result").exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(3000)
      await flushPromises()
      expect(w.get("#update-result").text()).toContain("1,203,411 → 1,204,615 domains (+1,204)")
      expect(w.find("#update-progress").exists()).toBe(false)
      expect(JSON.parse(localStorage.getItem("resolvr.blockListHistory")!).at(-1).total).toBe(1204615)
    })

    it("shows the server's error when the update cannot be started", async () => {
      vi.mocked(forceUpdateBlockLists).mockRejectedValue(new AppApiError("Permission denied.", 502))
      const w = await mountPage()
      await w.get("#update-now").trigger("click")
      await flushPromises()
      expect(w.get("#update-error").text()).toBe("Permission denied.")
      expect(w.get("#update-now").attributes("disabled")).toBeUndefined()
    })

    it("says so when the server has not finished after a minute and a half", async () => {
      const w = await mountPage()
      vi.useFakeTimers()
      vi.mocked(getSettings).mockResolvedValue(settings())
      await w.get("#update-now").trigger("click")
      await vi.advanceTimersByTimeAsync(95_000)
      await flushPromises()
      expect(w.get("#update-still").text()).toContain("has not finished yet")
      expect(w.find("#update-result").exists()).toBe(false)
    })
  })

  describe("feeds", () => {
    it("lists the configured feeds under their headings", async () => {
      const w = await mountPage()
      expect(w.findAll(".group-name").map((i) => (i.element as HTMLInputElement).value)).toEqual(["General threat intel", "Ads and trackers"])
      expect(w.findAll(".feed-row")).toHaveLength(2)
    })

    it("saves an edited list as the same flat list the server holds, then reloads it", async () => {
      const w = await mountPage()
      await w.get("#new-feed-url").setValue("https://c.example.net/new.txt")
      await w.get("#add-feed").trigger("click")
      await w.get("#feeds-save").trigger("click")
      await flushPromises()
      expect(updateBlockListUrls).toHaveBeenCalledWith([...LINES.slice(0, 2), "https://c.example.net/new.txt", ...LINES.slice(2)])
      expect(getSettings).toHaveBeenCalledTimes(2) // initial load + reload after saving
      expect(w.get("#undo-toast").text()).toContain("Saved 3 feeds")
    })

    it("saves and then starts an update in one go", async () => {
      const w = await mountPage()
      await w.findAll(".feed-remove")[0]!.trigger("click")
      expect(w.get("#unsaved-hint").text()).toContain("Save and update now")
      await w.get("#feeds-save-update").trigger("click")
      await flushPromises()
      expect(updateBlockListUrls).toHaveBeenCalled()
      expect(forceUpdateBlockLists).toHaveBeenCalledTimes(1)
    })

    it("shows a readable error and keeps the edits when saving fails", async () => {
      vi.mocked(updateBlockListUrls).mockRejectedValue(new AppApiError("Permission denied.", 502))
      const w = await mountPage()
      await w.findAll(".feed-remove")[0]!.trigger("click")
      await w.get("#feeds-save").trigger("click")
      await flushPromises()
      expect(w.get("#feeds-save-error").text()).toBe("Permission denied.")
      expect(w.find("#feeds-savebar").exists()).toBe(true)
    })

    it("is read-only for a viewer", async () => {
      const w = await mountPage("viewer")
      expect(w.find("#new-feed-url").exists()).toBe(false)
      expect(w.find(".feed-remove").exists()).toBe(false)
    })
  })

  describe("your blocked domains", () => {
    it("lists every blocked domain found by walking the tree, not just the root labels", async () => {
      const w = await mountPage("admin", "domains")
      expect(w.findAll(".blocked-row").map((r) => r.find("span").text())).toEqual(["ads.example.net", "example.com"])
      expect(w.get("#blocked-count").text()).toBe("2 of 2")
    })

    it("filters the list", async () => {
      const w = await mountPage("admin", "domains")
      await w.get("#blocked-filter").setValue("ads")
      expect(w.findAll(".blocked-row")).toHaveLength(1)
      expect(w.get("#blocked-count").text()).toBe("1 of 2")
    })

    it("says whether a typed domain is new, already blocked, covered by a parent, or invalid", async () => {
      const w = await mountPage("admin", "domains")
      const hint = () => w.get("#domain-hint").text()
      await w.get("#new-blocked-domain").setValue("nope")
      expect(hint()).toContain("not a valid domain")
      await w.get("#new-blocked-domain").setValue("ads.example.net")
      expect(hint()).toContain("already on your list")
      expect(w.find("#unblock-typed").exists()).toBe(true)
      await w.get("#new-blocked-domain").setValue("banner.ads.example.net")
      expect(hint()).toContain("Already covered: ads.example.net")
      expect(w.get("#add-blocked-domain").attributes("disabled")).toBeDefined()
      await w.get("#new-blocked-domain").setValue("new.example.org")
      expect(hint()).toContain("not blocked yet")
      expect(w.get("#add-blocked-domain").text()).toBe("Block new.example.org")
    })

    it("blocks a new domain, shows it in the list, and can undo", async () => {
      const w = await mountPage("admin", "domains")
      await w.get("#new-blocked-domain").setValue("New.Example.org")
      await w.get("#add-blocked-domain").trigger("click")
      await flushPromises()
      expect(blockDomain).toHaveBeenCalledWith("new.example.org")
      expect(w.findAll(".blocked-row").map((r) => r.find("span").text())).toContain("new.example.org")
      expect(w.get("#undo-toast").text()).toContain("Blocked new.example.org")

      await w.get("#undo-toast-undo").trigger("click")
      await flushPromises()
      expect(unblockDomain).toHaveBeenCalledWith("new.example.org")
      expect(w.findAll(".blocked-row").map((r) => r.find("span").text())).not.toContain("new.example.org")
    })

    it("shows a readable error, not a raw stack trace, when blocking fails", async () => {
      vi.mocked(blockDomain).mockRejectedValue(new AppApiError("Permission denied.", 502))
      const w = await mountPage("admin", "domains")
      await w.get("#new-blocked-domain").setValue("new.example.org")
      await w.get("#add-blocked-domain").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-action-error").text()).toBe("Permission denied.")
    })

    it("unblocks from the list and can bring it back", async () => {
      const w = await mountPage("admin", "domains")
      await w.findAll(".row-unblock")[0]!.trigger("click") // ads.example.net
      await flushPromises()
      expect(unblockDomain).toHaveBeenCalledWith("ads.example.net")
      expect(w.findAll(".blocked-row")).toHaveLength(1)

      await w.get("#undo-toast-undo").trigger("click")
      await flushPromises()
      expect(blockDomain).toHaveBeenCalledWith("ads.example.net")
      expect(w.findAll(".blocked-row")).toHaveLength(2)
    })

    it("blocks a pasted list, skipping what is already covered or invalid", async () => {
      const w = await mountPage("admin", "domains")
      await w.get("#bulk-toggle").trigger("click")
      await w.get("#bulk-text").setValue("a.example.org\nb.example.org\nx.ads.example.net\nnot valid")
      expect(w.get("#bulk-summary").text()).toContain("2 new, 1 already blocked, 2 not valid")
      expect(w.get("#bulk-block").text()).toBe("Block 2 domains")
      await w.get("#bulk-block").trigger("click")
      await flushPromises()
      expect(blockDomain).toHaveBeenCalledTimes(2)
      expect(w.findAll(".blocked-row")).toHaveLength(4)
    })

    it("reports partial failure when some pasted domains cannot be blocked", async () => {
      vi.mocked(blockDomain).mockImplementation((async (d: string) => {
        if (d === "b.example.org") throw new AppApiError("no", 502)
        return { status: "ok" }
      }) as never)
      const w = await mountPage("admin", "domains")
      await w.get("#bulk-toggle").trigger("click")
      await w.get("#bulk-text").setValue("a.example.org\nb.example.org")
      await w.get("#bulk-block").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-action-error").text()).toContain("Blocked 1 of 2. Could not block: b.example.org")
    })

    it("hides the controls from a viewer but still lists the domains", async () => {
      const w = await mountPage("viewer", "domains")
      expect(w.find("#new-blocked-domain").exists()).toBe(false)
      expect(w.find(".row-unblock").exists()).toBe(false)
      expect(w.findAll(".blocked-row")).toHaveLength(2)
      expect(w.text()).toContain("Only admins can block or unblock domains")
    })

    it("exports the blocked zones as a download", async () => {
      const file = { blob: new Blob(["x"]), filename: "blocked.txt" }
      vi.mocked(exportBlockedZones).mockResolvedValue(file as never)
      const w = await mountPage("admin", "domains")
      await w.get("#export-blocked").trigger("click")
      await flushPromises()
      expect(triggerDownload).toHaveBeenCalledWith(file)
    })

    it("shows an error when the tree cannot be read, and an empty state when nothing is blocked", async () => {
      vi.mocked(listBlockedZones).mockRejectedValue(new TechnitiumApiError("Server unreachable.", 502))
      const bad = await mountPage("admin", "domains")
      expect(bad.get("#blocked-error").text()).toBe("Server unreachable.")
      bad.unmount()

      clearCache()
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } } as never)
      const empty = await mountPage("admin", "domains")
      expect(empty.text()).toContain("You have not blocked any domains yet")
    })

    it("can still browse the tree", async () => {
      const w = await mountPage("admin", "domains")
      const details = w.get("details")
      ;(details.element as HTMLDetailsElement).open = true
      await details.trigger("toggle")
      await flushPromises()
      expect(w.findAll("#blocked-zone-tree > li, #blocked-zone-tree > div").length + w.text().split("com").length).toBeGreaterThan(1)
      expect(w.get("#blocked-zone-tree").text()).toContain("com")
    })

    it("refetches everything when the topbar refresh button is used", async () => {
      const w = await mountPage("admin", "domains")
      vi.mocked(getSettings).mockClear()
      vi.mocked(listBlockedZones).mockClear()
      useRefreshStore().trigger()
      await flushPromises()
      expect(getSettings).toHaveBeenCalledTimes(1)
      expect(listBlockedZones).toHaveBeenCalled()
      expect(w.get("#blocked-count").text()).toBe("2 of 2")
    })
  })

  describe("check a domain", () => {
    const blockedBy = (extra: string) =>
      ({ response: { result: { RCODE: "NxDomain", Answer: [], EDNS: { Options: [{ Code: "EXTENDED_DNS_ERROR", Data: { InfoCode: "Blocked", ExtraText: extra } }] } } } }) as never

    it("names the feed that blocked a domain, and points at it in the feeds list", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue(blockedBy("source=block-list-zone; blockListUrl=https://b.example.org/ads.txt; domain=ads.example.net"))
      const w = await mountPage("admin", "check")
      await w.get("#check-domain").setValue("ads.example.net")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(resolveDnsQuery).toHaveBeenCalledWith("ads.example.net", "A", expect.anything(), expect.objectContaining({ server: "this-server" }))
      expect(w.get("#check-verdict").text()).toContain("matches a feed: https://b.example.org/ads.txt")
      await w.get("#show-feed").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-tab-feeds").attributes("aria-selected")).toBe("true")
      const matched = w.findAll(".feed-row").find((r) => r.text().includes("b.example.org"))!
      expect(matched.text()).toContain("Matched")
    })

    it("says a name on your own list is blocked, and highlights it", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue(blockedBy("source=blocked-zone; domain=example.com"))
      const w = await mountPage("admin", "check")
      await w.get("#check-domain").setValue("www.example.com")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("is on your blocked domains (through example.com)")
      await w.get("#show-domain").trigger("click")
      await flushPromises()
      expect(w.get("#blocked-tab-domains").attributes("aria-selected")).toBe("true")
      expect(w.find("#blocked-domain-list").exists()).toBe(true)
    })

    it("reports an allowed name with its addresses, and a name that does not exist", async () => {
      vi.mocked(resolveDnsQuery).mockResolvedValue({ response: { result: { RCODE: "NoError", Answer: [{ RDATA: { IPAddress: "192.0.2.1" } }], EDNS: { Options: [] } } } } as never)
      const w = await mountPage("admin", "check")
      await w.get("#check-domain").setValue("www.example.org")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("Allowed. Your server answers www.example.org normally with 192.0.2.1")

      vi.mocked(resolveDnsQuery).mockResolvedValue({ response: { result: { RCODE: "NxDomain", Answer: [], EDNS: { Options: [] } } } } as never)
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-verdict").text()).toContain("does not exist, and it is not blocked")
    })

    it("asks for a real domain, and shows a readable error when the server cannot be asked", async () => {
      const w = await mountPage("admin", "check")
      await w.get("#check-domain").setValue("nope")
      await w.get("#check-go").trigger("click")
      expect(w.get("#check-message").text()).toContain("Enter a domain")
      expect(resolveDnsQuery).not.toHaveBeenCalled()

      vi.mocked(resolveDnsQuery).mockRejectedValue(new TechnitiumApiError("Server unreachable.", 502))
      await w.get("#check-domain").setValue("example.org")
      await w.get("#check-go").trigger("click")
      await flushPromises()
      expect(w.get("#check-message").text()).toBe("Server unreachable.")
    })
  })
})
