import { describe, it, expect } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { openDb } from "../db.js";
import { attachUser } from "../auth.js";
import { authRoutes } from "./authRoutes.js";

function testApp() {
  const db = openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "adminpass1" } });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser(db));
  app.use("/api/auth", authRoutes(db));
  return { app, db };
}

describe("authRoutes", () => {
  it("logs in with correct credentials and sets a session cookie", async () => {
    const { app } = testApp();

    const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "adminpass1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: "admin", role: "admin" });
    expect(res.headers["set-cookie"]?.[0]).toContain("resolvr_session=");
  });

  it("does not mark the session cookie Secure by default — browsers drop Secure cookies over plain HTTP, which is how this app is normally deployed", async () => {
    const original = process.env.COOKIE_SECURE;
    delete process.env.COOKIE_SECURE;
    try {
      const { app } = testApp();
      const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "adminpass1" });
      expect(res.headers["set-cookie"]?.[0]).not.toContain("Secure");
    } finally {
      if (original === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = original;
    }
  });

  it("marks the session cookie Secure when COOKIE_SECURE=true is explicitly set", async () => {
    const original = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = "true";
    try {
      const { app } = testApp();
      const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "adminpass1" });
      expect(res.headers["set-cookie"]?.[0]).toContain("Secure");
    } finally {
      if (original === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = original;
    }
  });

  it("rejects an incorrect password", async () => {
    const { app } = testApp();

    const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an unknown username", async () => {
    const { app } = testApp();

    const res = await request(app).post("/api/auth/login").send({ username: "ghost", password: "whatever12" });

    expect(res.status).toBe(401);
  });

  it("/me returns 401 when not logged in", async () => {
    const { app } = testApp();

    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
  });

  it("/me returns the current user once logged in, and logout ends the session", async () => {
    const { app } = testApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: "admin", password: "adminpass1" });

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ username: "admin", role: "admin" });

    await agent.post("/api/auth/logout");
    const meAfterLogout = await agent.get("/api/auth/me");
    expect(meAfterLogout.status).toBe(401);
  });
});
