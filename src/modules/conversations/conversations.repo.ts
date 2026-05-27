import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

const participantInclude = {
  participants: {
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

const messageSenderSelect = {
  sender: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.MessageInclude;

export const conversationsRepo = {
  findExisting(args: {
    productId?: string;
    shopId?: string;
    userIds: [string, string];
  }) {
    return prisma.conversation.findFirst({
      where: {
        productId: args.productId ?? null,
        shopId: args.shopId ?? null,
        AND: args.userIds.map((userId) => ({
          participants: { some: { userId } },
        })),
      },
      include: participantInclude,
    });
  },

  create(args: {
    productId?: string;
    shopId?: string;
    userIds: [string, string];
  }) {
    return prisma.conversation.create({
      data: {
        productId: args.productId,
        shopId: args.shopId,
        participants: {
          create: args.userIds.map((userId) => ({ userId })),
        },
      },
      include: participantInclude,
    });
  },

  findById(id: string) {
    return prisma.conversation.findUnique({
      where: { id },
      include: participantInclude,
    });
  },

  listForUser(userId: string) {
    return prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      include: {
        ...participantInclude,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  },

  touchUpdatedAt(id: string) {
    return prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  },

  listMessages(args: { conversationId: string; take: number; cursor?: string }) {
    return prisma.message.findMany({
      where: { conversationId: args.conversationId },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: messageSenderSelect,
    });
  },

  createMessage(data: Prisma.MessageCreateInput) {
    return prisma.message.create({ data, include: messageSenderSelect });
  },

  findMessageById(id: string) {
    return prisma.message.findUnique({ where: { id } });
  },

  updateMessage(id: string, data: Prisma.MessageUpdateInput) {
    return prisma.message.update({
      where: { id },
      data,
      include: messageSenderSelect,
    });
  },
};
