import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, resolveDnsQuery: vi.fn(), getClusterState: vi.fn() }
})

import { resolveDnsQuery, getClusterState } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { useStatsScopeStore } from "../../stores/statsScope"
import ResolverView from "./ResolverView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))

function answer(ip: string, rcode = "NoError") {
  return {
    response: {
      result: {
        Question: [{ Name: "x.test", Type: "A" }],
        RCODE: rcode,
        Metadata: { NameServer: "n", RoundTripTime: "1 ms" },
        Answer: ip ? [{ Name: "x.test", Type: "A", TTL: "60", RDATA: { IPAddress: ip } }] : [],
      },
    },
  } as never
}

async function mountCluster(scopeNode?: string) {
  const connection = useConnectionStore()
  connection.serverDomain = NODE1
  connection.clusterInitialized = true
  vi.mocked(getClusterState).mockResolvedValue({
    response: {
      clusterInitialized: true,
      clusterNodes: [
        { id: 1, name: NODE1, type: "Primary", state: "Self" },
        { id: 2, name: NODE2, type: "Secondary", state: "Connected" },
      ],
    },
  })
  const s = useStatsScopeStore()
  await vi.waitFor(() => expect(s.nodes.length).toBe(2))
  if (scopeNode) s.set("resolverPage", scopeNode)
  const wrapper = mount(ResolverView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  return wrapper
}

async function ask(wrapper: Awaited<ReturnType<typeof mountCluster>>) {
  await wrapper.get("#resolve-domain").setValue("x.test")
  await wrapper.get("form").trigger("submit")
  await flush()
  await flush()
}

describe("ResolverView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(resolveDnsQuery).mockReset()
  })

  it("asks every node and says when they agree", async () => {
    vi.mocked(resolveDnsQuery).mockResolvedValue(answer("1.2.3.4"))
    const wrapper = await mountCluster()

    await ask(wrapper)

    expect(resolveDnsQuery).toHaveBeenCalledTimes(2)
    const nodes = vi.mocked(resolveDnsQuery).mock.calls.map((c) => (c[3] as { node?: string }).node)
    expect(nodes).toContain(undefined)
    expect(nodes).toContain(NODE2)
    expect(wrapper.findAll(".resolve-node")).toHaveLength(2)
    expect(wrapper.get("#resolve-agreement").text()).toContain("same answer")
  })

  it("says when the nodes answer differently", async () => {
    vi.mocked(resolveDnsQuery).mockImplementation((async (_d: string, _t: string, _c: unknown, o?: { node?: string }) =>
      o?.node === NODE2 ? answer("9.9.9.9") : answer("1.2.3.4")) as never)
    const wrapper = await mountCluster()

    await ask(wrapper)

    expect(wrapper.get("#resolve-agreement").text()).toContain("differently")
  })

  it("keeps the other node's answer when one node cannot be asked", async () => {
    vi.mocked(resolveDnsQuery).mockImplementation((async (_d: string, _t: string, _c: unknown, o?: { node?: string }) => {
      if (o?.node === NODE2) throw new Error("boom")
      return answer("1.2.3.4")
    }) as never)
    const wrapper = await mountCluster()

    await ask(wrapper)

    expect(wrapper.text()).toContain("1.2.3.4")
    expect(wrapper.text()).toMatch(/could not be asked/)
  })

  it("scoped to one node it is the plain tool", async () => {
    vi.mocked(resolveDnsQuery).mockResolvedValue(answer("1.2.3.4"))
    const wrapper = await mountCluster(NODE2)

    await ask(wrapper)

    expect(resolveDnsQuery).toHaveBeenCalledTimes(1)
    expect((vi.mocked(resolveDnsQuery).mock.calls[0]![3] as { node?: string }).node).toBe(NODE2)
    expect(wrapper.find("#resolve-nodes").exists()).toBe(false)
    expect(wrapper.find("#resolve-result").exists()).toBe(true)
  })
})
