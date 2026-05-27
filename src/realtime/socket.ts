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

export function initSocket(httpServer: HttpServer) {
  io = new IoServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = parseSessionCookie(socket.handshake.headers.cookie);
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = jwt.verify(token, env.JWT_SECRET) as SessionUser;
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as SessionUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.join(`user:${user.id}`);
    logger.info("socket: connected", { userId: user.id, socketId: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("socket: disconnected", {
        userId: user.id,
        socketId: socket.id,
        reason,
      });
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

export function broadcastToUser(userId: string, event: string, payload: unknown) {
  if (!io) {
    logger.warn("socket: broadcast attempted before init", { event });
    return;
  }
  io.to(`user:${userId}`).emit(event, payload);
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
