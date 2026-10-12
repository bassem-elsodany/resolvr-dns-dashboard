import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listAdminSessions: vi.fn(), getClusterState: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, revokeSession: vi.fn() }
})

import { listAdminSessions, getClusterState } from "../../api/technitium"
import { revokeSession } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import { useStatsScopeStore } from "../../stores/statsScope"
import SessionsView from "./SessionsView.vue"

const NODE1 = "node1.cluster.test"
const NODE2 = "node2.cluster.test"
const flush = () => new Promise((r) => setTimeout(r, 0))
const sess = (token: string, user: string, current = false) => ({
  username: user, isCurrentSession: current, partialToken: token, type: "Standard", tokenName: null,
  lastSeen: "2026-10-12T05:00:00Z", lastSeenRemoteAddress: "10.0.0.1",
})

const SESSIONS: Record<string, ReturnType<typeof sess>[]> = {
  [NODE1]: [sess("aaaa1111", "admin", true), sess("shared999", "admin")],
  [NODE2]: [sess("bbbb2222", "viewer"), sess("shared999", "admin")],
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
  if (scopeNode) s.set("sessionsPage", scopeNode)
  useAuthStore().user = { id: 1, username: "admin", role: "admin" }
  const wrapper = mount(SessionsView, { global: { stubs: { RouterLink: true } } })
  connection.isConfigured = true
  await flush()
  await flush()
  return wrapper
}

describe("SessionsView on a cluster", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(getClusterState).mockReset()
    vi.mocked(listAdminSessions).mockReset().mockImplementation((async (_c: unknown, o?: { node?: string }) => ({ response: { sessions: SESSIONS[o?.node ?? NODE1] } })) as never)
    vi.mocked(revokeSession).mockReset().mockResolvedValue({ status: "ok" })
  })

  it("lists every node's sessions with the node, keeping a token shared by both nodes as two rows", async () => {
    const wrapper = await mountCluster()

    const rows = wrapper.findAll("tbody tr")
    expect(rows).toHaveLength(4)
    expect(wrapper.findAll(".session-node").map((n) => n.text())).toEqual(["node1", "node1", "node2", "node2"])
  })

  it("revokes a session on the node it is on", async () => {
    const wrapper = await mountCluster()
    const viewer = wrapper.findAll("tbody tr").find((r) => r.text().includes("viewer"))!

    await viewer.get(".revoke-session").trigger("click")
    await viewer.findAll("button").find((b) => b.text() === "Confirm")!.trigger("click")
    await flush()
    await flush()

    expect(revokeSession).toHaveBeenCalledWith("bbbb2222", NODE2)
  })

  it("revokes on the connected node without naming it", async () => {
    const wrapper = await mountCluster()
    const onNode1 = wrapper.findAll("tbody tr").filter((r) => r.text().includes("node1") && !r.text().includes("this session"))[0]!

    await onNode1.get(".revoke-session").trigger("click")
    await onNode1.findAll("button").find((b) => b.text() === "Confirm")!.trigger("click")
    await flush()
    await flush()

    expect(revokeSession).toHaveBeenCalledWith("shared999")
  })

  it("scoped to one node it looks like the plain page", async () => {
    const wrapper = await mountCluster(NODE2)

    expect(wrapper.find(".session-node").exists()).toBe(false)
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
  })
})
