import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { actionRoutes } from "./actionRoutes.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function testApp(fetchImpl: typeof fetch, configured = true) {
  const db = openDb({ path: ":memory:" });
  if (configured) {
    db.prepare("UPDATE app_config SET base_url = ?, token = ? WHERE id = 1").run(
      "http://192.168.1.53:5380",
      "secret-token",
    );
  }
  const app = express();
  app.use(express.json());
  app.use("/api/actions", actionRoutes(db, { fetchImpl }));
  return { app, db };
}

describe("actionRoutes", () => {
  it("flushes the DNS cache by calling the exact Technitium endpoint, with the stored token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://192.168.1.53:5380/api/cache/flush");
    expect(calledInit?.method).toBe("POST");
    expect(new Headers(calledInit?.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  // On a Technitium cluster each node keeps its own cache, so a flush can be
  // aimed at one node. The call is still the same single hardcoded endpoint.
  it("flushes the cache of one cluster node when a node is named", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/flush-cache").send({ node: "node2.cluster.test" });

    expect(res.status).toBe(200);
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/cache/flush");
    expect(url.searchParams.get("node")).toBe("node2.cluster.test");
  });

  it("sends no node parameter when none is named", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    await request(app).post("/api/actions/flush-cache").send({});

    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.has("node")).toBe(false);
  });

  it("rejects a node that is not a plain host name, and does not call Technitium", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    for (const node of ["node2/../../x", "a b", "x&token=1", 5, ""]) {
      const res = await request(app).post("/api/actions/flush-cache").send({ node });
      expect(res.status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Zones, host mappings and block-list settings are kept per node on a
  // Technitium cluster, so these admin actions can be aimed at one node.
  const NODE_ACTIONS: { name: string; method: "post" | "put"; path: string; body: Record<string, unknown>; technitium: string }[] = [
    { name: "create a zone", method: "post", path: "/api/actions/create-zone", body: { zone: "home.lan" }, technitium: "/api/zones/create" },
    {
      name: "add a record",
      method: "post",
      path: "/api/actions/add-record",
      body: { domain: "nas.home.lan", zone: "home.lan", type: "A", ipAddress: "10.0.0.5" },
      technitium: "/api/zones/records/add",
    },
    { name: "delete a zone", method: "post", path: "/api/actions/delete-zone", body: { zone: "home.lan" }, technitium: "/api/zones/delete" },
    { name: "force a block-list update", method: "post", path: "/api/actions/update-block-lists", body: {}, technitium: "/api/settings/forceUpdateBlockLists" },
    { name: "save the block-list feeds", method: "put", path: "/api/actions/block-list-urls", body: { urls: ["https://example.com/a.txt"] }, technitium: "/api/settings/set" },
    { name: "uninstall an app", method: "post", path: "/api/actions/uninstall-app", body: { name: "Block Page" }, technitium: "/api/apps/uninstall" },
    { name: "revoke a session", method: "post", path: "/api/actions/revoke-session", body: { partialToken: "abcd1234" }, technitium: "/api/admin/sessions/delete" },
  ];

  for (const a of NODE_ACTIONS) {
    it(`can ${a.name} on one named cluster node`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
      const { app } = testApp(fetchImpl);

      const res = await request(app)[a.method](a.path).send({ ...a.body, node: "node2.cluster.test" });

      expect(res.status).toBe(200);
      const url = new URL(String(fetchImpl.mock.calls[0]![0]));
      expect(url.pathname).toBe(a.technitium);
      expect(url.searchParams.get("node")).toBe("node2.cluster.test");
    });

    it(`sends no node when ${a.name} is not aimed at one`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
      const { app } = testApp(fetchImpl);

      await request(app)[a.method](a.path).send(a.body);

      expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.has("node")).toBe(false);
    });

    it(`refuses a node that is not a plain host name when asked to ${a.name}`, async () => {
      const fetchImpl = vi.fn<typeof fetch>();
      const { app } = testApp(fetchImpl);

      const res = await request(app)[a.method](a.path).send({ ...a.body, node: "x&token=1" });

      expect(res.status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }

  it("forces a block-list update by calling the exact Technitium endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/update-block-lists");

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://192.168.1.53:5380/api/settings/forceUpdateBlockLists");
  });

  it("updates the block list URLs, comma-joined in order, comments and URLs alike", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app)
      .put("/api/actions/block-list-urls")
      .send({ urls: ["# Hagezi PRO++", "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.plus.txt"] });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/settings/set");
    expect(url.searchParams.get("blockListUrls")).toBe(
      "# Hagezi PRO++,https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.plus.txt",
    );
  });

  it("sends 'false' to clear the block list URLs when saved as an empty list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).put("/api/actions/block-list-urls").send({ urls: [] });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    expect(new URL(String(calledUrl)).searchParams.get("blockListUrls")).toBe("false");
  });

  it("rejects a non-array urls body, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).put("/api/actions/block-list-urls").send({ urls: "not-an-array" });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an entry containing a comma or a line break, which would split into two entries upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const comma = await request(app).put("/api/actions/block-list-urls").send({ urls: ["# Hagezi, NSFW", "https://a.example.com/x.txt"] });
    const lineBreak = await request(app).put("/api/actions/block-list-urls").send({ urls: ["https://a.example.com/x.txt\nhttps://b.example.com/y.txt"] });

    expect(comma.status).toBe(400);
    expect(lineBreak.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds a domain to the Blocked Zones list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/block-domain").send({ domain: "example.com" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/blocked/add");
    expect(url.searchParams.get("domain")).toBe("example.com");
  });

  it("rejects block-domain without a domain, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/block-domain").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("removes a domain from the Blocked Zones list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/unblock-domain").send({ domain: "example.com" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/blocked/delete");
    expect(url.searchParams.get("domain")).toBe("example.com");
  });

  it("rejects unblock-domain without a domain, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/unblock-domain").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uninstalls an app by name", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/uninstall-app").send({ name: "Block Page" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/apps/uninstall");
    expect(url.searchParams.get("name")).toBe("Block Page");
  });

  it("rejects uninstall-app without a name, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/uninstall-app").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a Primary zone for a host mapping", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/create-zone").send({ zone: "nas2" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/zones/create");
    expect(url.searchParams.get("zone")).toBe("nas2");
    expect(url.searchParams.get("type")).toBe("Primary");
  });

  it("rejects create-zone without a zone, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/create-zone").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds an A record mapping a hostname to an IP", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app)
      .post("/api/actions/add-record")
      .send({ domain: "nas2", zone: "nas2", type: "A", ipAddress: "10.0.10.201", ttl: 300 });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/zones/records/add");
    expect(url.searchParams.get("domain")).toBe("nas2");
    expect(url.searchParams.get("zone")).toBe("nas2");
    expect(url.searchParams.get("type")).toBe("A");
    expect(url.searchParams.get("ipAddress")).toBe("10.0.10.201");
    expect(url.searchParams.get("ttl")).toBe("300");
  });

  it("rejects add-record with a type other than A or AAAA, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app)
      .post("/api/actions/add-record")
      .send({ domain: "nas2", type: "CNAME", ipAddress: "10.0.10.201" });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects add-record without an ipAddress, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/add-record").send({ domain: "nas2", type: "A" });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes a zone, removing a host mapping entirely", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok" }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/delete-zone").send({ zone: "nas2" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/zones/delete");
    expect(url.searchParams.get("zone")).toBe("nas2");
  });

  it("rejects delete-zone without a zone, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/delete-zone").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revokes a session by partialToken", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "ok", response: {} }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/revoke-session").send({ partialToken: "ddfaecb8e9325e77" });

    expect(res.status).toBe(200);
    const [calledUrl] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/api/admin/sessions/delete");
    expect(url.searchParams.get("partialToken")).toBe("ddfaecb8e9325e77");
  });

  it("rejects revoke-session without a partialToken, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/revoke-session").send({});

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 400 for any action when no server is configured yet, without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = testApp(fetchImpl, false);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 502 with Technitium's error message when the action fails upstream", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "error", errorMessage: "Permission denied." }));
    const { app } = testApp(fetchImpl);

    const res = await request(app).post("/api/actions/flush-cache");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Permission denied.");
  });
});
