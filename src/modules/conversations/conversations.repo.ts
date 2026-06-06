import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

const userSelect = {
  id: true,
  name: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const conversationParticipantsInclude = {
  buyer: { select: userSelect },
  seller: { select: userSelect },
  shop: {
    select: {
      id: true,
      name: true,
      handle: true,
      avatarUrl: true,
      isActive: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ConversationInclude;

export const messageInclude = {
  sender: { select: userSelect },
  adminAuthor: { select: { id: true } },
  contextProduct: {
    select: {
      id: true,
      name: true,
      price: true,
      cover: true,
    },
  },
  storyContextStory: {
    select: {
      id: true,
      shopId: true,
      mediaType: true,
      mediaUrl: true,
      posterUrl: true,
      caption: true,
      deletedAt: true,
      expiresAt: true,
    },
  },
  reactions: {
    select: { userId: true, emoji: true },
  },
  reads: {
    select: { userId: true, deliveredAt: true, readAt: true },
  },
  invoice: {
    include: {
      lines: { orderBy: { position: "asc" } },
    },
  },
} satisfies Prisma.MessageInclude;

export const conversationsRepo = {
  findByPair(buyerId: string, sellerId: string) {
    return prisma.conversation.findUnique({
      where: { buyerId_sellerId: { buyerId, sellerId } },
      include: conversationParticipantsInclude,
    });
  },

  findById(id: string) {
    return prisma.conversation.findUnique({
      where: { id },
      include: conversationParticipantsInclude,
    });
  },

  create(args: { buyerId: string; sellerId: string; shopId: string }) {
    return prisma.conversation.create({
      data: {
        buyer: { connect: { id: args.buyerId } },
        seller: { connect: { id: args.sellerId } },
        shop: { connect: { id: args.shopId } },
      },
      include: conversationParticipantsInclude,
    });
  },

  listForUser(userId: string) {
    return prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { lastActivityAt: "desc" },
      include: {
        ...conversationParticipantsInclude,
        lastMessage: { include: messageInclude },
      },
    });
  },

  listAllMessages(conversationId: string) {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: messageInclude,
    });
  },

  searchMessages(conversationId: string, query: string) {
    return prisma.message.findMany({
      where: {
        conversationId,
        content: { contains: query, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        content: true,
        createdAt: true,
      },
    });
  },

  createMessage(data: Prisma.MessageCreateInput) {
    return prisma.message.create({ data, include: messageInclude });
  },

  findMessageById(id: string) {
    return prisma.message.findUnique({ where: { id }, include: messageInclude });
  },

  updateMessage(id: string, data: Prisma.MessageUpdateInput) {
    return prisma.message.update({ where: { id }, data, include: messageInclude });
  },

  touchConversation(id: string, lastMessageId: string) {
    return prisma.conversation.update({
      where: { id },
      data: {
        lastMessageId,
        lastActivityAt: new Date(),
      },
    });
  },

  upsertDelivered(messageId: string, userId: string, when: Date) {
    return prisma.messageRead.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { deliveredAt: when },
      create: { messageId, userId, deliveredAt: when },
    });
  },

  markRead(args: {
    conversationId: string;
    readerId: string;
    throughMessageId: string;
    when: Date;
  }) {
    return prisma.$transaction(async (tx) => {
      const through = await tx.message.findUnique({
        where: { id: args.throughMessageId },
        select: { id: true, createdAt: true, conversationId: true },
      });
      if (!through || through.conversationId !== args.conversationId) return [];
      const cutoff = through.createdAt;

      const messagesToMark = await tx.message.findMany({
        where: {
          conversationId: args.conversationId,
          senderId: { not: args.readerId },
          createdAt: { lte: cutoff },
        },
        select: { id: true, senderId: true, createdAt: true },
      });

      for (const m of messagesToMark) {
        await tx.messageRead.upsert({
          where: { messageId_userId: { messageId: m.id, userId: args.readerId } },
          update: { readAt: args.when, deliveredAt: args.when },
          create: {
            messageId: m.id,
            userId: args.readerId,
            readAt: args.when,
            deliveredAt: args.when,
          },
        });
      }
      return messagesToMark;
    });
  },

  upsertReaction(messageId: string, userId: string, emoji: string) {
    return prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { emoji },
      create: { messageId, userId, emoji },
    });
  },

  deleteReaction(messageId: string, userId: string) {
    return prisma.messageReaction.deleteMany({
      where: { messageId, userId },
    });
  },

  listReactions(messageId: string) {
    return prisma.messageReaction.findMany({
      where: { messageId },
      select: { userId: true, emoji: true },
    });
  },
};
