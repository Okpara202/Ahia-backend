import { prisma } from "../../config/db.js";
import { AppError, ForbiddenError, NotFoundError } from "../../errors.js";
import { uploadImageBuffer, uploadVoiceBuffer } from "../../integrations/cloudinary.js";
import { broadcastToConversation, broadcastToUser } from "../../realtime/socket.js";
import { conversationsRepo } from "./conversations.repo.js";
import type {
  EditTextInput,
  ReactionInput,
  SendImageInput,
  SendTextInput,
  SendVoiceInput,
  StartConversationInput,
} from "./conversations.schemas.js";
import {
  buildConversationResponse,
  buildInboxItem,
  formatMessageOut,
} from "./conversations.mapper.js";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

const COLD_DM_DAILY_LIMIT = 50;

async function startAsBuyer(buyerId: string, sellerId: string) {
  if (buyerId === sellerId) {
    throw new AppError(400, "self_conversation", "You can't message your own shop.");
  }
  const existing = await conversationsRepo.findByPair(buyerId, sellerId);
  if (existing) return buildConversationResponse(existing, [], buyerId);

  const shop = await resolveShopAndSeller(sellerId);
  if (shop.deletedAt) {
    throw new AppError(403, "shop_gone", "This shop is no longer available.");
  }
  if (!shop.isActive) {
    throw new AppError(
      403,
      "shop_paused",
      "This seller is on a break and isn't taking new orders right now.",
    );
  }
  const convo = await conversationsRepo.create({ buyerId, sellerId, shopId: shop.id });
  return buildConversationResponse(convo, [], buyerId);
}

async function startAsSeller(sellerId: string, buyerId: string) {
  if (buyerId === sellerId) {
    throw new AppError(400, "self_conversation", "You can't message yourself.");
  }
  const existing = await conversationsRepo.findByPair(buyerId, sellerId);
  if (existing) return buildConversationResponse(existing, [], sellerId);

  const sellerShop = await prisma.shop.findFirst({
    where: { ownerId: sellerId, deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!sellerShop) {
    throw new AppError(
      403,
      "not_seller",
      "You must have an active shop to start a conversation.",
    );
  }

  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { id: true, allowsColdDMs: true },
  });
  if (!buyer) throw new NotFoundError("User");
  if (!buyer.allowsColdDMs) {
    throw new AppError(
      403,
      "buyer_blocks_cold_dms",
      "This user doesn't accept messages from sellers they haven't bought from.",
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentColdConversations = await prisma.conversation.count({
    where: {
      sellerId,
      createdAt: { gte: since },
    },
  });
  if (recentColdConversations >= COLD_DM_DAILY_LIMIT) {
    throw new AppError(
      429,
      "cold_dm_limit",
      "You've reached the daily limit for new conversations.",
    );
  }

  const convo = await conversationsRepo.create({
    buyerId,
    sellerId,
    shopId: sellerShop.id,
  });
  return buildConversationResponse(convo, [], sellerId);
}

async function resolveShopAndSeller(sellerId: string) {
  const shop = await prisma.shop.findFirst({
    where: { ownerId: sellerId, deletedAt: null },
    select: { id: true, isActive: true, deletedAt: true, ownerId: true },
  });
  if (!shop) {
    throw new AppError(404, "no_shop", "This user does not have an active shop.");
  }
  return shop;
}

async function assertParticipant(conversationId: string, userId: string) {
  const convo = await conversationsRepo.findById(conversationId);
  if (!convo) throw new NotFoundError("Conversation");
  if (convo.buyerId !== userId && convo.sellerId !== userId) {
    throw new ForbiddenError("Not a participant in this conversation");
  }
  return convo;
}

function counterpartyOf(convo: { buyerId: string; sellerId: string }, userId: string) {
  return convo.buyerId === userId ? convo.sellerId : convo.buyerId;
}

async function resolveStoryContextData(storyId: string | undefined) {
  if (!storyId) return {};
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      mediaType: true,
      mediaUrl: true,
      posterUrl: true,
      caption: true,
      deletedAt: true,
      expiresAt: true,
    },
  });
  if (!story || story.deletedAt) {
    throw new NotFoundError("Story");
  }
  return {
    storyContextStory: { connect: { id: story.id } },
    storyContextMediaUrl: story.mediaUrl,
    storyContextMediaType: story.mediaType,
    storyContextPosterUrl: story.posterUrl,
    storyContextCaption: story.caption,
  };
}

async function persistMessage(args: {
  convoId: string;
  senderId: string;
  data: Parameters<typeof conversationsRepo.createMessage>[0];
  recipientId: string;
  emitExtraEvent?: string;
}) {
  const message = await conversationsRepo.createMessage(args.data);
  await conversationsRepo.touchConversation(args.convoId, message.id);
  await conversationsRepo.upsertDelivered(message.id, args.recipientId, new Date());

  const refreshed = await conversationsRepo.findMessageById(message.id);
  const out = formatMessageOut(refreshed!, args.recipientId);
  broadcastToUser(args.recipientId, "message:new", {
    conversationId: args.convoId,
    message: out,
  });
  // Mirror to the conversation room so any admin watching a live dispute on
  // this conversation sees buyer/seller replies in real time.
  broadcastToConversation(args.convoId, "message:new", {
    conversationId: args.convoId,
    message: out,
  });
  broadcastToUser(args.senderId, "message:delivered", {
    messageId: message.id,
    conversationId: args.convoId,
    deliveredAt: new Date().toISOString(),
  });
  if (args.emitExtraEvent) {
    broadcastToUser(args.recipientId, args.emitExtraEvent, {
      conversationId: args.convoId,
      message: out,
    });
  }
  return out;
}

export const conversationsService = {
  async start(userId: string, input: StartConversationInput) {
    if (input.sellerId) {
      return startAsBuyer(userId, input.sellerId);
    }
    if (input.buyerId) {
      return startAsSeller(userId, input.buyerId);
    }
    throw new AppError(400, "validation", "Provide sellerId or buyerId.");
  },

  async listMine(userId: string) {
    const rows = await conversationsRepo.listForUser(userId);
    const counts = await Promise.all(
      rows.map((row) =>
        prisma.message.count({
          where: {
            conversationId: row.id,
            senderId: { not: userId },
            reads: { none: { userId, readAt: { not: null } } },
          },
        }),
      ),
    );
    return rows.map((row, i) => buildInboxItem(row, userId, counts[i] ?? 0));
  },

  async getById(userId: string, conversationId: string) {
    const convo = await assertParticipant(conversationId, userId);
    const messages = await conversationsRepo.listAllMessages(conversationId);
    return buildConversationResponse(convo, messages, userId);
  },

  async sendText(userId: string, conversationId: string, input: SendTextInput) {
    const convo = await assertParticipant(conversationId, userId);
    const storyContextData = await resolveStoryContextData(input.storyId);

    return persistMessage({
      convoId: conversationId,
      senderId: userId,
      recipientId: counterpartyOf(convo, userId),
      data: {
        conversation: { connect: { id: conversationId } },
        sender: { connect: { id: userId } },
        type: "text",
        content: input.content,
        ...(input.contextProductId && {
          contextProduct: { connect: { id: input.contextProductId } },
        }),
        ...storyContextData,
      },
    });
  },

  async sendImage(
    userId: string,
    conversationId: string,
    fileBuffer: Buffer,
    input: SendImageInput,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const storyContextData = await resolveStoryContextData(input.storyId);
    const imageUrl = await uploadImageBuffer(fileBuffer, {
      folder: `ahia/messages/${conversationId}`,
    });
    return persistMessage({
      convoId: conversationId,
      senderId: userId,
      recipientId: counterpartyOf(convo, userId),
      emitExtraEvent: "image:new",
      data: {
        conversation: { connect: { id: conversationId } },
        sender: { connect: { id: userId } },
        type: "image",
        imageUrl,
        content: input.caption,
        ...(input.contextProductId && {
          contextProduct: { connect: { id: input.contextProductId } },
        }),
        ...storyContextData,
      },
    });
  },

  async sendVoice(
    userId: string,
    conversationId: string,
    fileBuffer: Buffer,
    input: SendVoiceInput,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const storyContextData = await resolveStoryContextData(input.storyId);
    const voiceUrl = await uploadVoiceBuffer(fileBuffer, {
      folder: `ahia/voice/${conversationId}`,
    });
    return persistMessage({
      convoId: conversationId,
      senderId: userId,
      recipientId: counterpartyOf(convo, userId),
      data: {
        conversation: { connect: { id: conversationId } },
        sender: { connect: { id: userId } },
        type: "voice",
        voiceUrl,
        voiceDurationMs: input.durationMs,
        ...(input.contextProductId && {
          contextProduct: { connect: { id: input.contextProductId } },
        }),
        ...storyContextData,
      },
    });
  },

  async editText(
    userId: string,
    conversationId: string,
    messageId: string,
    input: EditTextInput,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const message = await conversationsRepo.findMessageById(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundError("Message");
    }
    if (message.senderId !== userId) {
      throw new AppError(403, "not_sender", "Only the sender can edit this message.");
    }
    if (message.type !== "text") {
      throw new AppError(400, "not_text", "Only text messages can be edited.");
    }
    const ageMs = Date.now() - message.createdAt.getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      throw new AppError(
        400,
        "edit_window_expired",
        "Messages can only be edited within 15 minutes.",
      );
    }

    const updated = await conversationsRepo.updateMessage(messageId, {
      content: input.content,
      editedAt: new Date(),
    });
    const out = formatMessageOut(updated, userId);
    const recipientId = counterpartyOf(convo, userId);
    broadcastToUser(recipientId, "message:edited", {
      conversationId,
      message: out,
    });
    return out;
  },

  async setReaction(
    userId: string,
    conversationId: string,
    messageId: string,
    input: ReactionInput,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const message = await conversationsRepo.findMessageById(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundError("Message");
    }

    const existing = message.reactions.find((r) => r.userId === userId);
    if (existing && existing.emoji === input.emoji) {
      await conversationsRepo.deleteReaction(messageId, userId);
    } else {
      await conversationsRepo.upsertReaction(messageId, userId, input.emoji);
    }
    const reactions = await conversationsRepo.listReactions(messageId);
    const recipientId = counterpartyOf(convo, userId);
    const payload = { messageId, conversationId, reactions };
    broadcastToUser(recipientId, "message:reaction_changed", payload);
    broadcastToUser(userId, "message:reaction_changed", payload);
    return { reactions };
  },

  async markRead(userId: string, conversationId: string, throughMessageId: string) {
    const convo = await assertParticipant(conversationId, userId);
    const when = new Date();
    const marked = await conversationsRepo.markRead({
      conversationId,
      readerId: userId,
      throughMessageId,
      when,
    });
    const senderId = counterpartyOf(convo, userId);
    if (marked.length > 0) {
      broadcastToUser(senderId, "message:read", {
        conversationId,
        throughMessageId,
        readerId: userId,
        readAt: when.toISOString(),
      });
    }
    return { count: marked.length, readAt: when.toISOString() };
  },

  async searchMessages(userId: string, conversationId: string, q: string) {
    await assertParticipant(conversationId, userId);
    const rows = await conversationsRepo.searchMessages(conversationId, q);
    return rows.map((row) => ({
      messageId: row.id,
      snippet: row.content?.slice(0, 200) ?? "",
      createdAt: row.createdAt,
    }));
  },

  async handleTyping(userId: string, conversationId: string, state: "start" | "stop") {
    const convo = await assertParticipant(conversationId, userId);
    const recipientId = counterpartyOf(convo, userId);
    broadcastToUser(recipientId, state === "start" ? "typing:start" : "typing:stop", {
      conversationId,
      userId,
    });
  },

  async flushDeliveredFor(userId: string) {
    const undelivered = await prisma.message.findMany({
      where: {
        senderId: { not: userId },
        conversation: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
        },
        reads: { none: { userId } },
      },
      select: { id: true, conversationId: true, senderId: true },
      take: 200,
      orderBy: { createdAt: "asc" },
    });
    if (undelivered.length === 0) return;
    const when = new Date();
    for (const m of undelivered) {
      await conversationsRepo.upsertDelivered(m.id, userId, when);
      if (m.senderId) {
        broadcastToUser(m.senderId, "message:delivered", {
          messageId: m.id,
          conversationId: m.conversationId,
          deliveredAt: when.toISOString(),
        });
      }
    }
  },

  async assertParticipant(conversationId: string, userId: string) {
    return assertParticipant(conversationId, userId);
  },

  async refreshMessage(messageId: string, viewerId: string) {
    const message = await conversationsRepo.findMessageById(messageId);
    if (!message) return null;
    return formatMessageOut(message, viewerId);
  },
};

