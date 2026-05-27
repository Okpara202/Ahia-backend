import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsRepo } from "./notifications.repo.js";
import type { ListNotificationsQuery } from "./notifications.schemas.js";
import type { Prisma } from "@prisma/client";

export const notificationsService = {
  async list(userId: string, query: ListNotificationsQuery) {
    const rows = await notificationsRepo.listForUser({
      userId,
      take: query.limit,
      cursor: query.cursor,
      unreadOnly: query.unreadOnly,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    const unreadCount = await notificationsRepo.countUnread(userId);
    return { items, nextCursor, unreadCount };
  },

  async markRead(userId: string, id: string) {
    await notificationsRepo.markRead(id, userId);
  },

  async markAllRead(userId: string) {
    await notificationsRepo.markAllRead(userId);
  },

  async createForUser(userId: string, type: string, payload: Prisma.InputJsonValue) {
    const notification = await notificationsRepo.create({
      user: { connect: { id: userId } },
      type,
      payload,
    });
    broadcastToUser(userId, "notification:new", { notification });
    return notification;
  },
};
