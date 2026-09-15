import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import type { NextFunction, Request, Response } from "express";
import type { UserRole, UserRow } from "./db.js";

export const SESSION_COOKIE = "resolvr_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function createSession(db: Database, userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return token;
}

export function deleteSession(db: Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getSessionUser(db: Database, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT users.id as id, users.username as username, users.role as role, sessions.expires_at as expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`,
    )
    .get(token) as (UserRow & { expires_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.id, username: row.username, role: row.role };
}

const cookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS,
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions);
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: cookieOptions.secure });
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

// Attaches req.user from the session cookie when present and valid —
// never rejects on its own, so routes that allow anonymous access
// (there are none yet, but this keeps the middleware composable) can
// still run. requireAuth/requireAdmin below do the actual gating.
export function attachUser(db: Database) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    req.user = getSessionUser(db, req.cookies?.[SESSION_COOKIE]) ?? undefined;
    next();
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}
