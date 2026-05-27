import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

export const notificationsRepo = {
  listForUser(args: {
    userId: string;
    take: number;
    cursor?: string;
    unreadOnly?: boolean;
  }) {
    return prisma.notification.findMany({
      where: {
        userId: args.userId,
        ...(args.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
    });
  },

  countUnread(userId: string) {
    return prisma.notification.count({
      where: { userId, readAt: null },
    });
  },

  create(data: Prisma.NotificationCreateInput) {
    return prisma.notification.create({ data });
  },

  markRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  },

  markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};
