import { Router } from "express";
import type { Database } from "better-sqlite3";
import { createSession, deleteSession, setSessionCookie, clearSessionCookie, verifyPassword, SESSION_COOKIE } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import type { UserRow } from "../db.js";

export function authRoutes(db: Database): Router {
  const router = Router();

  router.post("/login", (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const token = createSession(db, user.id);
    setSessionCookie(res, token);
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  router.post("/logout", (req, res) => {
    const token = (req as AuthedRequest).cookies?.[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    clearSessionCookie(res);
    res.json({ status: "ok" });
  });

  router.get("/me", (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(user);
  });

  return router;
}
