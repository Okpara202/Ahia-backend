import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsRepo } from "./notifications.repo.js";
import type { ListNotificationsQuery } from "./notifications.schemas.js";
import type { Prisma } from "@prisma/client";

type RenderedNotification = {
  type: string;
  title: string;
  body: string;
  link: string | null;
  payload: Record<string, unknown>;
};

function clamp(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

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

  async archive(userId: string, id: string) {
    await notificationsRepo.archive(id, userId);
  },

  async createForUser(userId: string, rendered: RenderedNotification) {
    const notification = await notificationsRepo.create({
      user: { connect: { id: userId } },
      type: rendered.type,
      title: clamp(rendered.title, 120),
      body: clamp(rendered.body, 240),
      link: rendered.link,
      payload: rendered.payload as Prisma.InputJsonValue,
    });
    broadcastToUser(userId, "notification:new", { notification });
    return notification;
  },
};
