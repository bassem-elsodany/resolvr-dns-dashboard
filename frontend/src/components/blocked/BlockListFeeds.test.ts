import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import BlockListFeeds from "./BlockListFeeds.vue"

const LINES = ["# Threat intel", "https://a.example.com/t.txt", "https://b.example.org/m.txt", "# Ads", "https://c.example.net/a.txt"]

function mountFeeds(over: Record<string, unknown> = {}) {
  return mount(BlockListFeeds, { props: { lines: LINES, isAdmin: true, saving: false, saveError: null, highlightUrl: null, ...over } })
}

const urls = (w: ReturnType<typeof mountFeeds>) => w.findAll(".feed-row").map((r) => r.find("a").text())

describe("BlockListFeeds", () => {
  it("shows feeds under their headings with a count", () => {
    const w = mountFeeds()
    expect(w.findAll(".group-name").map((i) => (i.element as HTMLInputElement).value)).toEqual(["Threat intel", "Ads"])
    expect(urls(w)).toHaveLength(3)
    expect(w.findAll(".feed-group")[0]!.text()).toContain("2 feeds")
    expect(w.findAll(".feed-group")[1]!.text()).toContain("1 feed")
    expect(w.findAll(".feed-group")[1]!.text()).not.toContain("1 feeds")
  })

  it("shows no save bar until something changes", () => {
    expect(mountFeeds().find("#feeds-savebar").exists()).toBe(false)
  })

  it("adds a feed to the chosen group and offers to save it", async () => {
    const w = mountFeeds()
    await w.get("#new-feed-url").setValue("https://d.example.com/n.txt")
    await w.get("#new-feed-group").setValue(String((w.findAll(".group-name")[1]!.element as HTMLInputElement) && w.get("#new-feed-group").findAll("option")[1]!.attributes("value")))
    await w.get("form").trigger("submit")
    expect(w.findAll(".feed-group")[1]!.text()).toContain("https://d.example.com/n.txt")
    expect(w.get("#feeds-savebar").text()).toContain("1 added")
    await w.get("#feeds-save").trigger("click")
    expect(w.emitted("save")![0]).toEqual([[...LINES.slice(0, 3), "# Ads", "https://c.example.net/a.txt", "https://d.example.com/n.txt"], false])
  })

  it("rejects a bad or duplicate address and keeps the list unchanged", async () => {
    const w = mountFeeds()
    await w.get("#new-feed-url").setValue("not a url")
    await w.get("form").trigger("submit")
    expect(w.get("#add-feed-error").text()).toContain("web address")
    await w.get("#new-feed-url").setValue("https://a.example.com/t.txt")
    await w.get("form").trigger("submit")
    expect(w.get("#add-feed-error").text()).toContain("already")
    expect(w.find("#feeds-savebar").exists()).toBe(false)
  })

  it("marks a feed for removal, lets it be undone, and drops it on save", async () => {
    const w = mountFeeds()
    await w.findAll(".feed-remove")[0]!.trigger("click")
    expect(w.findAll(".feed-row")[0]!.text()).toContain("Removing")
    expect(w.get("#feeds-savebar").text()).toContain("1 removed")

    await w.get(".feed-undo").trigger("click")
    expect(w.find("#feeds-savebar").exists()).toBe(false)

    await w.findAll(".feed-remove")[0]!.trigger("click")
    await w.get("#feeds-save").trigger("click")
    expect(w.emitted("save")![0]![0]).toEqual(["# Threat intel", "https://b.example.org/m.txt", "# Ads", "https://c.example.net/a.txt"])
  })

  it("moves a feed up, down and across a group boundary", async () => {
    const w = mountFeeds()
    await w.findAll(".feed-down")[1]!.trigger("click") // b.example.org moves into the next group
    expect(w.findAll(".feed-group")[0]!.findAll(".feed-row")).toHaveLength(1)
    expect(w.findAll(".feed-group")[1]!.findAll(".feed-row")[0]!.text()).toContain("b.example.org")
    expect(w.get("#feeds-savebar").text()).toContain("order changed")
  })

  it("disables moving the first feed up and the last feed down", () => {
    const w = mountFeeds()
    expect(w.findAll(".feed-up")[0]!.attributes("disabled")).toBeDefined()
    const downs = w.findAll(".feed-down")
    expect(downs[downs.length - 1]!.attributes("disabled")).toBeDefined()
  })

  it("renames a group", async () => {
    const w = mountFeeds()
    await w.findAll(".group-name")[1]!.setValue("Ads and trackers")
    expect(w.get("#feeds-savebar").text()).toContain("1 renamed")
    await w.get("#feeds-save").trigger("click")
    expect(w.emitted("save")![0]![0]).toContain("# Ads and trackers")
  })

  it("discards changes", async () => {
    const w = mountFeeds()
    await w.findAll(".feed-remove")[0]!.trigger("click")
    await w.get("#feeds-discard").trigger("click")
    expect(w.find("#feeds-savebar").exists()).toBe(false)
    expect(urls(w)).toHaveLength(3)
  })

  it("asks to update straight after saving when told to", async () => {
    const w = mountFeeds()
    await w.findAll(".feed-remove")[0]!.trigger("click")
    await w.get("#feeds-save-update").trigger("click")
    expect(w.emitted("save")![0]![1]).toBe(true)
  })

  it("edits as text, marking only unknown feeds as new", async () => {
    const w = mountFeeds()
    await w.get("#feeds-text-mode").trigger("click")
    expect((w.get("#feeds-text").element as HTMLTextAreaElement).value).toBe(LINES.join("\n"))
    await w.get("#feeds-text").setValue([...LINES, "https://z.example.com/z.txt"].join("\n"))
    await w.get("#feeds-text-apply").trigger("click")
    expect(w.get("#feeds-savebar").text()).toContain("1 added")
    expect(urls(w)).toHaveLength(4)
  })

  it("shows a heading-free list for feeds that had no heading", () => {
    const w = mountFeeds({ lines: ["https://a.example.com/t.txt"] })
    expect((w.get(".group-name").element as HTMLInputElement).value).toBe("")
  })

  it("is read-only for a viewer", () => {
    const w = mountFeeds({ isAdmin: false })
    expect(w.find("#new-feed-url").exists()).toBe(false)
    expect(w.find(".feed-remove").exists()).toBe(false)
    expect(w.find("#feeds-text-mode").exists()).toBe(false)
    expect(w.text()).toContain("Ask an admin")
    expect(w.get(".group-name").attributes("disabled")).toBeDefined()
  })

  it("invites an admin to add the first feed when there are none", () => {
    const w = mountFeeds({ lines: [] })
    expect(w.get("#feeds-empty").text()).toContain("Add one below")
  })

  it("points at a matched feed", () => {
    const w = mountFeeds({ highlightUrl: "https://b.example.org/m.txt" })
    const row = w.findAll(".feed-row").find((r) => r.text().includes("b.example.org"))!
    expect(row.text()).toContain("Matched")
  })

  it("shows a save error, and takes a fresh list from the server when nothing is being edited", async () => {
    const w = mountFeeds({ saveError: "Permission denied." })
    expect(w.get("#feeds-save-error").text()).toBe("Permission denied.")
    await w.setProps({ lines: ["# Only", "https://only.example.com/x.txt"], saveError: null })
    expect(urls(w)).toEqual(["https://only.example.com/x.txt"])
  })
})

describe("BlockListFeeds with divider headings", () => {
  const REAL = [
    "# --- AdGuard parity ---",
    "# ---AdGuard DNS filter---",
    "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
    "# EasyList Privacy",
    "https://v.firebog.net/hosts/Easyprivacy.txt",
    "# --- Adult / parental (multiple sources) ---",
    "# Hagezi NSFW",
    "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/nsfw.txt",
  ]
  const mountReal = () => mount(BlockListFeeds, { props: { lines: REAL, isAdmin: true, saving: false, saveError: null, highlightUrl: null } })

  it("shows heading-only lines as dividers instead of empty feed groups", () => {
    const w = mountReal()
    const groups = w.findAll(".feed-group")
    expect(groups).toHaveLength(5)
    expect(groups[0]!.find(".group-count").text()).toBe("Divider")
    expect(groups[1]!.find(".group-count").text()).toBe("1 feed")
  })

  it("shows exactly the same lines in the text editor, dividers included", async () => {
    const w = mountReal()
    await w.get("#feeds-text-mode").trigger("click")
    expect((w.get("#feeds-text").element as HTMLTextAreaElement).value).toBe(REAL.join("\n"))
  })

  it("is not treated as changed, and saves every line back unchanged when one feed is added", async () => {
    const w = mountReal()
    expect(w.find("#feeds-savebar").exists()).toBe(false)
    await w.get("#new-feed-url").setValue("https://z.example.com/z.txt")
    await w.get("form").trigger("submit")
    await w.get("#feeds-save").trigger("click")
    const saved = w.emitted("save")![0]![0] as string[]
    for (const line of REAL) expect(saved).toContain(line)
    expect(saved).toHaveLength(REAL.length + 1)
  })

  it("removes a divider only when asked, and says so in the save bar", async () => {
    const w = mountReal()
    expect(w.findAll(".group-remove")).toHaveLength(2)
    await w.findAll(".group-remove")[0]!.trigger("click")
    expect(w.get("#feeds-savebar").text()).toContain("1 heading removed")
    await w.get("#feeds-save").trigger("click")
    expect(w.emitted("save")![0]![0]).not.toContain("# --- AdGuard parity ---")
    expect(w.emitted("save")![0]![0]).toContain("# --- Adult / parental (multiple sources) ---")
  })

  it("keeps the heading when every feed under it is removed", async () => {
    const w = mountReal()
    await w.findAll(".feed-remove")[0]!.trigger("click") // the only feed in "AdGuard DNS filter"
    expect(w.findAll(".feed-group")[1]!.find(".group-count").text()).toBe("Divider")
    await w.get("#feeds-save").trigger("click")
    expect(w.emitted("save")![0]![0]).toContain("# ---AdGuard DNS filter---")
  })

  it("offers no remove-heading control to a viewer", () => {
    const w = mount(BlockListFeeds, { props: { lines: REAL, isAdmin: false, saving: false, saveError: null, highlightUrl: null } })
    expect(w.find(".group-remove").exists()).toBe(false)
  })
})
