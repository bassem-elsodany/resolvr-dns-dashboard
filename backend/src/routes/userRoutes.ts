import { Router } from "express";
import type { Database } from "better-sqlite3";
import { hashPassword } from "../auth.js";
import type { UserRole, UserRow } from "../db.js";

const VALID_ROLES: UserRole[] = ["admin", "viewer"];

function adminCount(db: Database): number {
  return (db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

function publicUser(row: UserRow) {
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

export function userRoutes(db: Database): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const rows = db.prepare("SELECT * FROM users ORDER BY username").all() as UserRow[];
    res.json({ users: rows.map(publicUser) });
  });

  router.post("/", (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== "string" || !username.trim() || typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "username is required and password must be at least 8 characters" });
      return;
    }
    if (typeof role !== "string" || !VALID_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: "role must be 'admin' or 'viewer'" });
      return;
    }
    try {
      const info = db
        .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
        .run(username.trim(), hashPassword(password), role);
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid) as UserRow;
      res.status(201).json(publicUser(row));
    } catch {
      res.status(409).json({ error: `Username "${username}" is already taken` });
    }
  });

  router.put("/:id/password", (req, res) => {
    const id = Number(req.params.id);
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    const result = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
    if (result.changes === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ status: "ok" });
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (row.role === "admin" && adminCount(db) <= 1) {
      res.status(409).json({ error: "Cannot delete the last remaining admin" });
      return;
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ status: "ok" });
  });

  return router;
}
