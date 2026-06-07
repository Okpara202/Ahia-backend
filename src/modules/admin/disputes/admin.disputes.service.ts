import crypto from "node:crypto";
import { prisma } from "../../../config/db.js";
import { AppError, NotFoundError } from "../../../errors.js";
import { uploadImageBuffer, uploadVoiceBuffer } from "../../../integrations/cloudinary.js";
import { assertFileKind } from "../../../middleware/mimeGuard.js";
import { writeAudit } from "../../../lib/audit.js";
import { broadcastToConversation, broadcastToUser } from "../../../realtime/socket.js";
import { conversationsRepo } from "../../conversations/conversations.repo.js";
import { formatMessageOut } from "../../conversations/conversations.mapper.js";
import { disputesService } from "../../disputes/disputes.service.js";
import { adminDisputesRepo } from "./admin.disputes.repo.js";
import type {
  ListDisputesQuery,
  PostAdminMessageInput,
  ResolveDisputeInput,
} from "./admin.disputes.schemas.js";
import type { AdminUser, DisputeStatus } from "@prisma/client";

const ADMIN_DISPLAY_NAME = "Ahia Support";

function statusesFor(filter: ListDisputesQuery["status"]): DisputeStatus[] | null {
  if (filter === "all") return null;
  if (filter === "open") return ["open", "reviewing"]; // both grant admin access
  return [filter];
}

function disputeListItem(row: Awaited<ReturnType<typeof adminDisputesRepo.list>>[number]) {
  const line = row.invoiceLine;
  const amount = Number(line.unitPrice) * line.quantity;
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    evidenceUrls: row.evidenceUrls,
    raisedAt: row.createdAt.toISOString(),
    ageHours: Math.max(0, Math.floor((Date.now() - row.createdAt.getTime()) / (60 * 60 * 1000))),
    amount,
    line: {
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      product: line.product
        ? { id: line.product.id, name: line.product.name, cover: line.product.cover }
        : null,
    },
    invoiceId: line.invoice.id,
    conversationId: line.invoice.conversationId,
    buyer: line.invoice.buyer,
    seller: line.invoice.seller,
    raisedBy: row.raisedBy,
  };
}

export const adminDisputesService = {
  async list(query: ListDisputesQuery) {
    const rows = await adminDisputesRepo.list({
      statuses: statusesFor(query.status),
      take: query.limit,
      cursor: query.cursor,
      sort: query.sort,
    });
    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;
    return { items: slice.map(disputeListItem), nextCursor };
  },

  async getById(admin: AdminUser, disputeId: string, ip?: string, userAgent?: string) {
    const dispute = await adminDisputesRepo.findById(disputeId);
    if (!dispute) throw new NotFoundError("Dispute");
    const line = dispute.invoiceLine;
    const invoice = line.invoice;

    // Chat history scoped via the dispute -> invoice_line -> invoice ->
    // conversation join, per CLAUDE.md §4. We do NOT expose any other
    // route to read these messages.
    const messages = await adminDisputesRepo.listConversationMessages(
      invoice.conversationId,
    );
    const out = messages.map((m) => formatMessageOut(m, admin.id));

    const [prevByBuyer, prevBySeller, wonByBuyer, wonBySeller] = await Promise.all([
      adminDisputesRepo.countByBuyer(invoice.buyer.id, disputeId),
      adminDisputesRepo.countBySeller(invoice.seller.id, disputeId),
      adminDisputesRepo.countWonByBuyer(invoice.buyer.id, disputeId),
      adminDisputesRepo.countWonBySeller(invoice.seller.id, disputeId),
    ]);

    // Audit read AFTER successfully assembling — don't log if we 404 / 403.
    await writeAudit({
      adminId: admin.id,
      action: "read_dispute_messages",
      targetType: "dispute",
      targetId: disputeId,
      ip,
      userAgent,
      metadata: { messageCount: messages.length },
    });

    return {
      dispute: {
        id: dispute.id,
        status: dispute.status,
        reason: dispute.reason,
        evidenceUrls: dispute.evidenceUrls,
        raisedAt: dispute.createdAt.toISOString(),
        resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
        resolution: dispute.resolution,
        resolutionNote: dispute.resolutionNote,
        resolvedByAdmin: dispute.resolvedByAdmin
          ? { id: dispute.resolvedByAdmin.id, name: dispute.resolvedByAdmin.name }
          : null,
        amount: Number(line.unitPrice) * line.quantity,
      },
      line: {
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        unitPrice: Number(line.unitPrice),
        status: line.status,
        resolvedBy: line.resolvedBy,
        product: line.product
          ? { id: line.product.id, name: line.product.name, cover: line.product.cover }
          : null,
      },
      invoice: {
        id: invoice.id,
        conversationId: invoice.conversationId,
        totalAmount: Number(invoice.totalAmount),
        status: invoice.status,
        paystackRef: invoice.paystackRef,
        paidAt: invoice.paidAt?.toISOString() ?? null,
        lines: invoice.lines.map((l) => ({
          id: l.id,
          name: l.name,
          quantity: l.quantity,
          unitPrice: Number(l.unitPrice),
          kind: l.kind,
          status: l.status,
          resolvedBy: l.resolvedBy,
          coverUrl: l.product?.cover ?? null,
          dispute: l.dispute
            ? {
                id: l.dispute.id,
                status: l.dispute.status,
                raisedAt: l.dispute.createdAt.toISOString(),
              }
            : null,
        })),
      },
      buyer: invoice.buyer,
      seller: invoice.seller,
      raisedBy: dispute.raisedBy,
      messages: out,
      counts: {
        previousDisputesByBuyer: prevByBuyer,
        previousDisputesBySeller: prevBySeller,
        previousDisputesWonByBuyer: wonByBuyer,
        previousDisputesWonBySeller: wonBySeller,
      },
    };
  },

  async postMessage(
    admin: AdminUser,
    disputeId: string,
    input: PostAdminMessageInput,
    media: { imageBuffer?: Buffer; audioBuffer?: Buffer },
    ip?: string,
    userAgent?: string,
  ) {
    const hasText = !!input.content && input.content.trim().length > 0;
    const hasImage = !!media.imageBuffer;
    const hasAudio = !!media.audioBuffer;
    if (!hasText && !hasImage && !hasAudio) {
      throw new AppError(
        400,
        "empty_message",
        "Message must include text, an image, or a voice note.",
      );
    }

    const dispute = await adminDisputesRepo.findById(disputeId);
    if (!dispute) throw new NotFoundError("Dispute");
    if (dispute.status !== "open" && dispute.status !== "reviewing") {
      throw new AppError(
        403,
        "dispute_resolved",
        "Cannot post in a resolved dispute.",
      );
    }
    const conversationId = dispute.invoiceLine.invoice.conversationId;
    const buyerId = dispute.invoiceLine.invoice.buyer.id;
    const sellerId = dispute.invoiceLine.invoice.seller.id;

    // First admin post in this conversation → inject the "joined" system
    // message FIRST so both parties see the entrance.
    const priorAdminMessages = await adminDisputesRepo.countAdminMessagesInConversation(
      conversationId,
    );
    if (priorAdminMessages === 0) {
      const sysMsg = await conversationsRepo.createMessage({
        conversation: { connect: { id: conversationId } },
        type: "system",
        content: `${ADMIN_DISPLAY_NAME} joined this conversation to help resolve the dispute.`,
      });
      await conversationsRepo.touchConversation(conversationId, sysMsg.id);
      const sysFull = await conversationsRepo.findMessageById(sysMsg.id);
      if (sysFull) {
        const sysOut = formatMessageOut(sysFull, admin.id);
        broadcastToUser(buyerId, "message:new", { conversationId, message: sysOut });
        broadcastToUser(sellerId, "message:new", { conversationId, message: sysOut });
        broadcastToConversation(conversationId, "message:new", {
          conversationId,
          message: sysOut,
        });
      }
    }

    let imageUrl: string | undefined;
    let voiceUrl: string | undefined;
    if (hasImage) {
      assertFileKind(media.imageBuffer!, "image", "image_file");
      imageUrl = await uploadImageBuffer(media.imageBuffer!, {
        folder: `ahia/admin/messages/${conversationId}`,
        publicId: crypto.randomUUID(),
      });
    } else if (hasAudio) {
      // No assertFileKind() for audio — frontend voice is webm/opus (EBML
      // container) which our sniffer labels as "video"; user-side voice
      // upload punts the check for the same reason. Cloudinary rejects
      // garbage downstream.
      voiceUrl = await uploadVoiceBuffer(media.audioBuffer!, {
        folder: `ahia/admin/voice/${conversationId}`,
        publicId: crypto.randomUUID(),
      });
    }

    const messageType: "image" | "voice" | "text" = hasImage
      ? "image"
      : hasAudio
        ? "voice"
        : "text";
    const message = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      adminAuthor: { connect: { id: admin.id } },
      type: messageType,
      content: hasText ? input.content : null,
      imageUrl,
      voiceUrl,
      voiceDurationMs: hasAudio ? input.durationMs : undefined,
    });
    await conversationsRepo.touchConversation(conversationId, message.id);
    const full = await conversationsRepo.findMessageById(message.id);
    const out = full ? formatMessageOut(full, admin.id) : null;
    if (out) {
      broadcastToUser(buyerId, "message:new", { conversationId, message: out });
      broadcastToUser(sellerId, "message:new", { conversationId, message: out });
      broadcastToConversation(conversationId, "message:new", {
        conversationId,
        message: out,
      });
    }

    await writeAudit({
      adminId: admin.id,
      action: "post_admin_message",
      targetType: "dispute",
      targetId: disputeId,
      ip,
      userAgent,
      metadata: { postedMessageId: message.id, hasImage, hasAudio },
    });

    return out;
  },

  async resolve(
    admin: AdminUser,
    disputeId: string,
    input: ResolveDisputeInput,
    ip?: string,
    userAgent?: string,
  ) {
    // Map the public-API resolution naming back to the DB enum.
    const resolution =
      input.resolution === "refunded" ? "refunded_to_buyer" : "released_to_seller";

    // Add the admin attribution + note BEFORE calling the existing resolve
    // service so the audit trail is complete even if the resolve fails.
    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        resolvedByAdminId: admin.id,
        resolutionNote: input.note,
      },
    });

    const updated = await disputesService.resolve(disputeId, { resolution });

    await writeAudit({
      adminId: admin.id,
      action: "resolve_dispute",
      targetType: "dispute",
      targetId: disputeId,
      reason: input.note,
      metadata: { resolution: input.resolution },
      ip,
      userAgent,
    });

    return updated;
  },
};
