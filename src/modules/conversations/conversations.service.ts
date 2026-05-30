import { prisma } from "../../config/db.js";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { broadcastToOthers, broadcastToUser } from "../../realtime/socket.js";
import { conversationsRepo } from "./conversations.repo.js";
import type { ListMessagesQuery, StartConversationInput } from "./conversations.schemas.js";

type ConvoWithParticipants = NonNullable<
  Awaited<ReturnType<typeof conversationsRepo.findById>>
>;

async function assertParticipant(
  conversationId: string,
  userId: string,
): Promise<ConvoWithParticipants> {
  const convo = await conversationsRepo.findById(conversationId);
  if (!convo) throw new NotFoundError("Conversation");
  const isParticipant = convo.participants.some((p) => p.userId === userId);
  if (!isParticipant) {
    throw new ForbiddenError("Not a participant in this conversation");
  }
  return convo;
}

async function resolveSellerId(
  productId: string | null,
  shopId: string | null,
): Promise<string> {
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { shop: { select: { ownerId: true } } },
    });
    if (!product) throw new NotFoundError("Product");
    return product.shop.ownerId;
  }
  if (shopId) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { ownerId: true },
    });
    if (!shop) throw new NotFoundError("Shop");
    return shop.ownerId;
  }
  throw new BadRequestError("Conversation has no product or shop reference");
}

async function assertShopAcceptingNewBuyers(
  productId: string | null,
  shopId: string | null,
) {
  let shop: { isActive: boolean; deletedAt: Date | null } | null = null;
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { shop: { select: { isActive: true, deletedAt: true } } },
    });
    shop = product?.shop ?? null;
  } else if (shopId) {
    shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { isActive: true, deletedAt: true },
    });
  }
  if (!shop) return;
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
}

function participantIds(convo: ConvoWithParticipants): string[] {
  return convo.participants.map((p) => p.userId);
}

export const conversationsService = {
  async start(userId: string, input: StartConversationInput) {
    const sellerId = await resolveSellerId(input.productId ?? null, input.shopId ?? null);
    if (sellerId === userId) {
      throw new AppError(400, "self_conversation", "You can't message your own shop.");
    }

    const existing = await conversationsRepo.findExisting({
      productId: input.productId,
      shopId: input.shopId,
      userIds: [userId, sellerId],
    });
    if (existing) return existing;

    await assertShopAcceptingNewBuyers(
      input.productId ?? null,
      input.shopId ?? null,
    );

    return conversationsRepo.create({
      productId: input.productId,
      shopId: input.shopId,
      userIds: [userId, sellerId],
    });
  },

  async listMine(userId: string) {
    return conversationsRepo.listForUser(userId);
  },

  async getById(userId: string, id: string) {
    return assertParticipant(id, userId);
  },

  async listMessages(userId: string, conversationId: string, query: ListMessagesQuery) {
    await assertParticipant(conversationId, userId);
    const rows = await conversationsRepo.listMessages({
      conversationId,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  },

  async sendText(userId: string, conversationId: string, body: string) {
    const convo = await assertParticipant(conversationId, userId);
    const message = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      sender: { connect: { id: userId } },
      type: "text",
      body,
    });
    await conversationsRepo.touchUpdatedAt(conversationId);
    broadcastToOthers(participantIds(convo), userId, "message:new", {
      conversationId,
      message,
    });
    return message;
  },

  async sendImage(
    userId: string,
    conversationId: string,
    fileBuffer: Buffer,
    caption: string | undefined,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const imageUrl = await uploadImageBuffer(fileBuffer, {
      folder: `ahia/messages/${conversationId}`,
    });
    const message = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      sender: { connect: { id: userId } },
      type: "image",
      imageUrl,
      imageCaption: caption,
    });
    await conversationsRepo.touchUpdatedAt(conversationId);
    const otherIds = participantIds(convo);
    broadcastToOthers(otherIds, userId, "message:new", {
      conversationId,
      message,
    });
    broadcastToOthers(otherIds, userId, "image:new", {
      conversationId,
      message,
    });
    return message;
  },

  async sendOffer(
    userId: string,
    conversationId: string,
    amount: number,
    note: string | undefined,
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const sellerId = await resolveSellerId(convo.productId, convo.shopId);
    if (userId === sellerId) {
      throw new ForbiddenError("Only the buyer can send an offer");
    }
    const message = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      sender: { connect: { id: userId } },
      type: "offer",
      offerAmount: amount,
      offerStatus: "pending",
      offerNote: note,
    });
    await conversationsRepo.touchUpdatedAt(conversationId);
    broadcastToOthers(participantIds(convo), userId, "message:new", {
      conversationId,
      message,
    });
    broadcastToUser(sellerId, "offer:new", { conversationId, message });
    return message;
  },

  async resolveOffer(
    userId: string,
    conversationId: string,
    messageId: string,
    status: "accepted" | "declined",
  ) {
    const convo = await assertParticipant(conversationId, userId);
    const sellerId = await resolveSellerId(convo.productId, convo.shopId);
    if (userId !== sellerId) {
      throw new ForbiddenError("Only the seller can accept or decline an offer");
    }
    const message = await conversationsRepo.findMessageById(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundError("Offer");
    }
    if (message.type !== "offer") {
      throw new BadRequestError("Message is not an offer");
    }
    if (message.offerStatus !== "pending") {
      throw new BadRequestError("Offer already resolved");
    }

    const updated = await conversationsRepo.updateMessage(messageId, {
      offerStatus: status,
    });

    const amount = message.offerAmount?.toString() ?? "?";
    const systemBody =
      status === "accepted"
        ? `Offer of ₦${amount} accepted`
        : `Offer of ₦${amount} declined`;
    const systemMessage = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      type: "system",
      body: systemBody,
    });
    await conversationsRepo.touchUpdatedAt(conversationId);

    broadcastToOthers(participantIds(convo), userId, "message:new", {
      conversationId,
      message: systemMessage,
    });
    const buyerId = participantIds(convo).find((id) => id !== sellerId);
    if (buyerId) {
      broadcastToUser(buyerId, "offer:resolved", {
        conversationId,
        messageId,
        status,
        offer: updated,
      });
    }

    return { offer: updated, system: systemMessage };
  },
};
