import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { openDb } from "../db.js";
import { userRoutes } from "./userRoutes.js";

function testApp() {
  const db = openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "adminpass1" } });
  const app = express();
  app.use(express.json());
  app.use("/api/users", userRoutes(db));
  return { app, db };
}

describe("userRoutes", () => {
  it("lists users without exposing password hashes", async () => {
    const { app } = testApp();

    const res = await request(app).get("/api/users");

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([{ id: 1, username: "admin", role: "admin", createdAt: expect.any(String) }]);
  });

  it("creates a viewer user", async () => {
    const { app } = testApp();

    const res = await request(app)
      .post("/api/users")
      .send({ username: "reader", password: "readerpass1", role: "viewer" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: "reader", role: "viewer" });
  });

  it("rejects a duplicate username", async () => {
    const { app } = testApp();

    const res = await request(app)
      .post("/api/users")
      .send({ username: "admin", password: "somethingelse1", role: "viewer" });

    expect(res.status).toBe(409);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { app } = testApp();

    const res = await request(app).post("/api/users").send({ username: "reader", password: "short", role: "viewer" });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid role", async () => {
    const { app } = testApp();

    const res = await request(app)
      .post("/api/users")
      .send({ username: "reader", password: "readerpass1", role: "superuser" });

    expect(res.status).toBe(400);
  });

  it("refuses to delete the last remaining admin", async () => {
    const { app } = testApp();

    const res = await request(app).delete("/api/users/1");

    expect(res.status).toBe(409);
  });

  it("allows deleting an admin once a second admin exists", async () => {
    const { app } = testApp();
    await request(app).post("/api/users").send({ username: "admin2", password: "adminpass2", role: "admin" });

    const res = await request(app).delete("/api/users/1");

    expect(res.status).toBe(200);
  });

  it("changes a user's password", async () => {
    const { app } = testApp();

    const res = await request(app).put("/api/users/1/password").send({ password: "brand-new-pass" });

    expect(res.status).toBe(200);
  });

  it("404s when changing the password of a user that doesn't exist", async () => {
    const { app } = testApp();

    const res = await request(app).put("/api/users/999/password").send({ password: "brand-new-pass" });

    expect(res.status).toBe(404);
  });
});
