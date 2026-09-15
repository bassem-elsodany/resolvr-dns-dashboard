import { describe, it, expect } from "vitest";
import { openDb } from "./db.js";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession } from "./auth.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects an incorrect one", () => {
    const hash = hashPassword("correct-horse");
    expect(verifyPassword("correct-horse", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("sessions", () => {
  function seededDb() {
    return openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "adminpass1" } });
  }

  it("resolves a valid session token back to its user", () => {
    const db = seededDb();
    const user = db.prepare("SELECT id, role FROM users WHERE username = 'admin'").get() as {
      id: number;
      role: "admin" | "viewer";
    };

    const token = createSession(db, user.id);
    const resolved = getSessionUser(db, token);

    expect(resolved).toEqual({ id: user.id, username: "admin", role: "admin" });
  });

  it("returns null for an unknown or missing token", () => {
    const db = seededDb();
    expect(getSessionUser(db, "not-a-real-token")).toBeNull();
    expect(getSessionUser(db, undefined)).toBeNull();
  });

  it("returns null and cleans up once a session has expired", () => {
    const db = seededDb();
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    const token = createSession(db, user.id);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      token,
    );

    expect(getSessionUser(db, token)).toBeNull();
    expect(db.prepare("SELECT * FROM sessions WHERE token = ?").get(token)).toBeUndefined();
  });

  it("invalidates a session immediately on logout", () => {
    const db = seededDb();
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    const token = createSession(db, user.id);

    deleteSession(db, token);

    expect(getSessionUser(db, token)).toBeNull();
  });
});
