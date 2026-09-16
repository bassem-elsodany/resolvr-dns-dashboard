import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";

let tmpFile: string | undefined;
afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
  tmpFile = undefined;
});

describe("openDb", () => {
  it("creates an empty app_config row on first open", () => {
    const db = openDb({ path: ":memory:" });
    const row = db.prepare("SELECT * FROM app_config WHERE id = 1").get() as { base_url: string; token: string };
    expect(row).toEqual({ id: 1, base_url: "", token: "" });
  });

  it("seeds an admin user when the users table is empty and seedAdmin is given", () => {
    const db = openDb({ path: ":memory:", seedAdmin: { username: "admin", password: "hunter22ab" } });

    const user = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as
      | { role: string; password_hash: string }
      | undefined;

    expect(user?.role).toBe("admin");
    expect(bcrypt.compareSync("hunter22ab", user!.password_hash)).toBe(true);
  });

  it("also seeds a viewer user when seedViewer is given alongside seedAdmin", () => {
    const db = openDb({
      path: ":memory:",
      seedAdmin: { username: "admin", password: "hunter22ab" },
      seedViewer: { username: "viewer", password: "readerpass1" },
    });

    const user = db.prepare("SELECT * FROM users WHERE username = 'viewer'").get() as
      | { role: string; password_hash: string }
      | undefined;

    expect(user?.role).toBe("viewer");
    expect(bcrypt.compareSync("readerpass1", user!.password_hash)).toBe(true);
    const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it("does not seed a viewer without seedAdmin also being seeded (first-boot-only, same as admin)", () => {
    const db = openDb({ path: ":memory:", seedAdmin: null, seedViewer: { username: "viewer", password: "readerpass1" } });

    const count = (db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("does not reseed or overwrite an existing admin on a later open (container restart)", () => {
    tmpFile = path.join(os.tmpdir(), `resolvr-test-${Date.now()}.db`);
    const first = openDb({ path: tmpFile, seedAdmin: { username: "admin", password: "original-pass" } });
    first.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(
      bcrypt.hashSync("changed-pass", 10),
    );
    first.close();

    const second = openDb({ path: tmpFile, seedAdmin: { username: "admin", password: "original-pass" } });
    const user = second.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as {
      password_hash: string;
    };
    const count = (second.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n;

    expect(count).toBe(1);
    expect(bcrypt.compareSync("changed-pass", user.password_hash)).toBe(true);
  });
});
