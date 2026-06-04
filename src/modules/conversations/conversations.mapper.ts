import type { Prisma } from "@prisma/client";
import type {
  conversationParticipantsInclude,
  messageInclude,
} from "./conversations.repo.js";

type ConvoRow = Prisma.ConversationGetPayload<{
  include: typeof conversationParticipantsInclude;
}>;

type ConvoRowWithLast = Prisma.ConversationGetPayload<{
  include: typeof conversationParticipantsInclude & {
    lastMessage: { include: typeof messageInclude };
  };
}>;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function toCounterpartyOut(user: { id: string; name: string; avatarUrl: string | null }) {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
  };
}

function shopOut(shop: ConvoRow["shop"]) {
  return {
    id: shop.id,
    name: shop.name,
    handle: shop.handle,
    avatarUrl: shop.avatarUrl ?? null,
    isActive: shop.isActive,
  };
}

function formatNaira(amount: number | string | { toNumber?: () => number }) {
  const n =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : typeof amount?.toNumber === "function"
          ? amount.toNumber()
          : Number(amount);
  return new Intl.NumberFormat("en-NG").format(n);
}

function snippetFor(message: MessageRow): string {
  switch (message.type) {
    case "text":
      return (message.content ?? "").slice(0, 80);
    case "voice": {
      const totalSec = Math.round((message.voiceDurationMs ?? 0) / 1000);
      const m = Math.floor(totalSec / 60);
      const s = (totalSec % 60).toString().padStart(2, "0");
      return `🎤 Voice (${m}:${s})`;
    }
    case "image":
      return "📷 Photo";
    case "invoice":
      return `🧾 Invoice ₦${formatNaira(message.invoice?.totalAmount ?? 0)}`;
    case "system":
      return message.content ?? "";
    default:
      return "";
  }
}

function deliveredReadFor(message: MessageRow, viewerId: string) {
  const targetUserId =
    message.senderId === viewerId
      ? message.reads.find((r) => r.userId !== viewerId)?.userId
      : viewerId;
  const row = targetUserId
    ? message.reads.find((r) => r.userId === targetUserId)
    : undefined;
  return {
    deliveredAt: row?.deliveredAt ? row.deliveredAt.toISOString() : null,
    readAt: row?.readAt ? row.readAt.toISOString() : null,
  };
}

export function formatMessageOut(message: MessageRow, viewerId: string) {
  const { deliveredAt, readAt } = deliveredReadFor(message, viewerId);
  const contextProduct = message.contextProduct
    ? {
        id: message.contextProduct.id,
        name: message.contextProduct.name,
        price: message.contextProduct.price,
        coverUrl: message.contextProduct.cover,
      }
    : null;

  const storyContext = message.storyContextStoryId
    ? {
        storyId: message.storyContextStoryId,
        mediaUrl: message.storyContextMediaUrl ?? "",
        mediaType: message.storyContextMediaType ?? "image",
        ...(message.storyContextPosterUrl
          ? { posterUrl: message.storyContextPosterUrl }
          : {}),
        ...(message.storyContextCaption
          ? { caption: message.storyContextCaption }
          : {}),
      }
    : undefined;

  const base = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    content: message.content ?? null,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    contextProduct,
    ...(storyContext ? { storyContext } : {}),
    deliveredAt,
    readAt,
    reactions: message.reactions.map((r) => ({ userId: r.userId, emoji: r.emoji })),
  };

  if (message.type === "voice") {
    return {
      ...base,
      voiceUrl: message.voiceUrl,
      voiceDurationMs: message.voiceDurationMs,
    };
  }
  if (message.type === "image") {
    return { ...base, imageUrl: message.imageUrl };
  }
  if (message.type === "invoice" && message.invoice) {
    return {
      ...base,
      invoice: {
        id: message.invoice.id,
        status: message.invoice.status,
        totalAmount: message.invoice.totalAmount,
        paystackRef: message.invoice.paystackRef,
        createdAt: message.invoice.createdAt.toISOString(),
        paidAt: message.invoice.paidAt?.toISOString() ?? null,
        cancelledAt: message.invoice.cancelledAt?.toISOString() ?? null,
        lines: message.invoice.lines.map((line) => ({
          id: line.id,
          kind: line.kind,
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          status: line.status,
          position: line.position,
          resolvedAt: line.resolvedAt?.toISOString() ?? null,
          autoReleaseAt: line.autoReleaseAt?.toISOString() ?? null,
          extendedAt: line.extendedAt?.toISOString() ?? null,
          extensionReason: line.extensionReason ?? null,
        })),
      },
    };
  }
  return base;
}

export function buildConversationResponse(
  convo: ConvoRow,
  messages: MessageRow[],
  viewerId: string,
) {
  return {
    conversation: {
      id: convo.id,
      buyer: toCounterpartyOut(convo.buyer),
      seller: toCounterpartyOut(convo.seller),
      shop: shopOut(convo.shop),
      createdAt: convo.createdAt.toISOString(),
      lastActivityAt: convo.lastActivityAt.toISOString(),
    },
    messages: messages.map((m) => formatMessageOut(m, viewerId)),
  };
}

export function buildInboxItem(
  convo: ConvoRowWithLast,
  viewerId: string,
  unreadCount: number,
) {
  const isBuyer = convo.buyerId === viewerId;
  const counterparty = isBuyer ? convo.seller : convo.buyer;
  const last = convo.lastMessage;
  return {
    id: convo.id,
    counterparty: toCounterpartyOut(counterparty),
    shop: shopOut(convo.shop),
    lastMessage: last
      ? {
          id: last.id,
          type: last.type,
          snippet: snippetFor(last),
          senderId: last.senderId,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    lastActivityAt: convo.lastActivityAt.toISOString(),
    unreadCount,
  };
}
