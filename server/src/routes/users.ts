import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { authUsers, authAccounts, authSessions, companyMemberships } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { unauthorized, badRequest } from "../errors.js";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function assertBoardUser(req: Request): string {
  if (req.actor.type !== "board" || !req.actor.userId) {
    throw unauthorized();
  }
  return req.actor.userId;
}

export function userRoutes(db: Db, storageService: StorageService) {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // GET /users/me — current user profile
  router.get("/users/me", async (req, res) => {
    const userId = assertBoardUser(req);

    const user = await db
      .select({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        image: authUsers.image,
        createdAt: authUsers.createdAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get company memberships
    const memberships = await db
      .select({
        companyId: companyMemberships.companyId,
        membershipRole: companyMemberships.membershipRole,
        status: companyMemberships.status,
      })
      .from(companyMemberships)
      .where(eq(companyMemberships.principalId, userId));

    res.json({
      ...user,
      memberships,
    });
  });

  // PATCH /users/me — update name, email
  router.patch("/users/me", async (req, res) => {
    const userId = assertBoardUser(req);
    const { name, email } = req.body as { name?: string; email?: string };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();

    const updated = await db
      .update(authUsers)
      .set(updates)
      .where(eq(authUsers.id, userId))
      .returning({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        image: authUsers.image,
      })
      .then((rows) => rows[0] ?? null);

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(updated);
  });

  // POST /users/me/avatar — upload avatar
  router.post("/users/me/avatar", async (req, res) => {
    const userId = assertBoardUser(req);

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Avatar exceeds ${MAX_AVATAR_BYTES} bytes (2MB max)` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }

    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported avatar type: ${contentType}. Allowed: png, jpg, webp` });
      return;
    }

    // Store avatar using the first company membership's ID as namespace, or "system"
    const firstMembership = await db
      .select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(eq(companyMemberships.principalId, userId))
      .then((rows) => rows[0] ?? null);

    const companyId = firstMembership?.companyId ?? "system";

    const stored = await storageService.putFile({
      companyId,
      namespace: "avatars",
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const avatarUrl = `/api/users/avatars/${stored.objectKey}`;

    await db
      .update(authUsers)
      .set({ image: avatarUrl, updatedAt: new Date() })
      .where(eq(authUsers.id, userId));

    res.json({ avatarUrl });
  });

  // GET /users/avatars/:objectKey(*) — serve avatar
  router.get("/users/avatars/*objectKey", async (req, res, next) => {
    const rawKey = req.params.objectKey;
    const objectKey = Array.isArray(rawKey) ? rawKey.join("/") : (rawKey as string);
    if (!objectKey) {
      res.status(400).json({ error: "Missing object key" });
      return;
    }

    // Derive companyId from object key (format: {companyId}/avatars/...)
    const companyId = objectKey.split("/")[0] ?? "system";

    try {
      const object = await storageService.getObject(companyId, objectKey);
      res.setHeader("Content-Type", object.contentType || "image/png");
      if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
      res.setHeader("Cache-Control", "public, max-age=3600");
      object.stream.on("error", (err) => next(err));
      object.stream.pipe(res);
    } catch {
      res.status(404).json({ error: "Avatar not found" });
    }
  });

  // POST /users/me/change-password — change password
  router.post("/users/me/change-password", async (req, res) => {
    const userId = assertBoardUser(req);
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      throw badRequest("currentPassword and newPassword are required");
    }
    if (newPassword.length < 8) {
      throw badRequest("New password must be at least 8 characters");
    }

    // Get current password hash from accounts table
    const account = await db
      .select({
        id: authAccounts.id,
        password: authAccounts.password,
      })
      .from(authAccounts)
      .where(eq(authAccounts.userId, userId))
      .then((rows) => rows[0] ?? null);

    if (!account || !account.password) {
      res.status(400).json({ error: "No password set for this account" });
      return;
    }

    // better-auth stores passwords as bcrypt hashes
    const { verifyPassword, hashPassword } = await import("better-auth/crypto");
    const valid = await verifyPassword({ hash: account.password, password: currentPassword });
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(authAccounts)
      .set({ password: newHash, updatedAt: new Date() })
      .where(eq(authAccounts.id, account.id));

    res.json({ success: true });
  });

  // GET /users/me/sessions — list active sessions
  router.get("/users/me/sessions", async (req, res) => {
    const userId = assertBoardUser(req);

    const sessions = await db
      .select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        ipAddress: authSessions.ipAddress,
        userAgent: authSessions.userAgent,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, userId));

    // Determine current session from cookie token
    const currentSessionToken = extractSessionToken(req);

    res.json(
      sessions.map((s) => ({
        ...s,
        isCurrent: currentSessionToken ? isTokenMatch(s.id, currentSessionToken) : false,
      })),
    );
  });

  // POST /users/me/sessions/:sessionId/revoke — revoke a session
  router.post("/users/me/sessions/:sessionId/revoke", async (req, res) => {
    const userId = assertBoardUser(req);
    const sessionId = req.params.sessionId as string;

    const session = await db
      .select({ id: authSessions.id, userId: authSessions.userId })
      .from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .then((rows) => rows[0] ?? null);

    if (!session || session.userId !== userId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
    res.json({ revoked: true });
  });

  // POST /users/me/sessions/revoke-all — revoke all sessions
  router.post("/users/me/sessions/revoke-all", async (req, res) => {
    const userId = assertBoardUser(req);

    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    res.json({ revoked: true });
  });

  return router;
}

function extractSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1] ?? null;
}

function isTokenMatch(sessionId: string, token: string): boolean {
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    return sessionId === hash;
  } catch {
    return false;
  }
}
