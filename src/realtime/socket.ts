import type { Server as HttpServer } from "node:http";
import { Server as IoServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { redis } from "../integrations/redis.js";
import type { SessionUser } from "../middleware/auth.js";

let io: IoServer | null = null;

function parseSessionCookie(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "session" && v) return decodeURIComponent(v);
  }
  return undefined;
}

function parseAdminCookie(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cookieName = env.ADMIN_COOKIE_NAME;
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === cookieName && v) return decodeURIComponent(v);
  }
  return undefined;
}

async function validateAdminSession(sessionId: string) {
  const { adminRepo } = await import("../modules/admin/auth/admin.repo.js");
  const session = await adminRepo.findActiveSession(sessionId);
  if (!session) return null;
  if (session.admin.status === "suspended" || !session.admin.totpEnabled) {
    return null;
  }
  return session.admin;
}

export function initSocket(httpServer: HttpServer) {
  io = new IoServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  io.use(async (socket, next) => {
    const cookie = socket.handshake.headers.cookie;
    // Try the user-app cookie first (most traffic).
    try {
      const token = parseSessionCookie(cookie);
      if (token) {
        const payload = jwt.verify(token, env.JWT_SECRET) as SessionUser;
        socket.data.user = payload;
        return next();
      }
    } catch {
      // Fall through and try admin cookie.
    }
    // Admin app cookie — DB-backed session, not a JWT.
    const adminSessionId = parseAdminCookie(cookie);
    if (adminSessionId) {
      const admin = await validateAdminSession(adminSessionId);
      if (admin) {
        socket.data.admin = { id: admin.id, role: admin.role };
        return next();
      }
    }
    next(new Error("UNAUTHORIZED"));
  });

  io.on("connection", (socket: Socket) => {
    const admin = socket.data.admin as { id: string; role: string } | undefined;
    if (admin) {
      socket.join("admins");
      logger.info("socket: admin connected", {
        adminId: admin.id,
        socketId: socket.id,
      });
      socket.on("disconnect", (reason) => {
        logger.info("socket: admin disconnected", {
          adminId: admin.id,
          socketId: socket.id,
          reason,
        });
      });
      return;
    }
    const user = socket.data.user as SessionUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.join(`user:${user.id}`);
    logger.info("socket: connected", { userId: user.id, socketId: socket.id });

    void flushDeliveredOnConnect(user.id);
    void markPresenceOnConnect(user.id);

    socket.on("heartbeat", async () => {
      try {
        const { presenceService } = await import(
          "../modules/presence/presence.service.js"
        );
        await presenceService.refreshOnline(user.id);
      } catch (err) {
        logger.warn("socket: heartbeat failed", {
          userId: user.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("typing:start", async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      try {
        const { conversationsService } = await import(
          "../modules/conversations/conversations.service.js"
        );
        await conversationsService.handleTyping(user.id, payload.conversationId, "start");
      } catch (err) {
        logger.warn("socket: typing:start failed", {
          userId: user.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("typing:stop", async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      try {
        const { conversationsService } = await import(
          "../modules/conversations/conversations.service.js"
        );
        await conversationsService.handleTyping(user.id, payload.conversationId, "stop");
      } catch (err) {
        logger.warn("socket: typing:stop failed", {
          userId: user.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info("socket: disconnected", {
        userId: user.id,
        socketId: socket.id,
        reason,
      });
      void markPresenceOnDisconnect(user.id);
    });
  });

  if (redis) {
    const pubClient = redis;
    const subClient = redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("socket: redis adapter enabled");
  } else {
    logger.warn(
      "socket: redis adapter disabled (REDIS_URL not set) — multi-instance broadcast disabled",
    );
  }

  return io;
}

async function flushDeliveredOnConnect(userId: string) {
  try {
    const { conversationsService } = await import(
      "../modules/conversations/conversations.service.js"
    );
    await conversationsService.flushDeliveredFor(userId);
  } catch (err) {
    logger.warn("socket: flushDeliveredFor failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function markPresenceOnConnect(userId: string) {
  try {
    const [{ presenceService }, { presenceAudience }] = await Promise.all([
      import("../modules/presence/presence.service.js"),
      import("../modules/presence/presence.audience.js"),
    ]);
    const { wasOffline } = await presenceService.markOnline(userId);
    if (wasOffline) {
      const ids = await presenceAudience.audienceFor(userId);
      const payload = { userId, online: true };
      for (const id of ids) broadcastToUser(id, "presence:changed", payload);
    }
  } catch (err) {
    logger.warn("socket: markPresenceOnConnect failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function markPresenceOnDisconnect(userId: string) {
  try {
    const [{ presenceService }, { presenceAudience }] = await Promise.all([
      import("../modules/presence/presence.service.js"),
      import("../modules/presence/presence.audience.js"),
    ]);
    await presenceService.markOffline(userId);
    const ids = await presenceAudience.audienceFor(userId);
    const payload = {
      userId,
      online: false,
      lastSeenAt: new Date().toISOString(),
    };
    for (const id of ids) broadcastToUser(id, "presence:changed", payload);
  } catch (err) {
    logger.warn("socket: markPresenceOnDisconnect failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function broadcastToUser(userId: string, event: string, payload: unknown) {
  if (!io) {
    logger.warn("socket: broadcast attempted before init", { event });
    return;
  }
  io.to(`user:${userId}`).emit(event, payload);
}

export function broadcastToAdmins(event: string, payload: unknown) {
  if (!io) {
    logger.warn("socket: broadcastToAdmins attempted before init", { event });
    return;
  }
  io.to("admins").emit(event, payload);
}

export function broadcastToOthers(
  participantUserIds: string[],
  actorId: string | null,
  event: string,
  payload: unknown,
) {
  for (const userId of participantUserIds) {
    if (userId !== actorId) broadcastToUser(userId, event, payload);
  }
}
