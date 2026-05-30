import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

export const invoiceInclude = {
  lines: { orderBy: { position: "asc" } },
  transaction: true,
} satisfies Prisma.InvoiceInclude;

export const invoicesRepo = {
  findById(id: string) {
    return prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
  },

  findByReference(reference: string) {
    return prisma.invoice.findUnique({
      where: { paystackRef: reference },
      include: invoiceInclude,
    });
  },

  create(args: {
    conversationId: string;
    sellerId: string;
    buyerId: string;
    totalAmount: number;
    lines: Prisma.InvoiceLineCreateManyInvoiceInput[];
  }) {
    return prisma.invoice.create({
      data: {
        conversation: { connect: { id: args.conversationId } },
        seller: { connect: { id: args.sellerId } },
        buyer: { connect: { id: args.buyerId } },
        totalAmount: args.totalAmount,
        lines: { createMany: { data: args.lines } },
      },
      include: invoiceInclude,
    });
  },

  cancel(id: string) {
    return prisma.invoice.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date() },
      include: invoiceInclude,
    });
  },

  setPaid(id: string, paystackRef: string, autoReleaseAt: Date) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: "paid", paystackRef, paidAt: new Date() },
        include: invoiceInclude,
      });
      await tx.invoiceLine.updateMany({
        where: { invoiceId: id, status: "pending" },
        data: { autoReleaseAt },
      });
      return updated;
    });
  },

  findLine(id: string) {
    return prisma.invoiceLine.findUnique({
      where: { id },
      include: { invoice: { include: invoiceInclude } },
    });
  },

  setLineStatus(id: string, status: "released" | "refunded") {
    return prisma.invoiceLine.update({
      where: { id },
      data: { status, resolvedAt: new Date() },
    });
  },

  findLinesEligibleForAutoRelease(now: Date) {
    return prisma.invoiceLine.findMany({
      where: {
        status: "pending",
        autoReleaseAt: { lte: now },
        invoice: { status: { in: ["paid", "partial_released", "partial_refunded"] } },
      },
      include: { invoice: true },
    });
  },
};

export async function recomputeInvoiceStatus(invoiceId: string) {
  const lines = await prisma.invoiceLine.findMany({
    where: { invoiceId },
    select: { status: true },
  });
  if (lines.length === 0) return;

  const hasPending = lines.some((l) => l.status === "pending");
  const hasReleased = lines.some((l) => l.status === "released");
  const hasRefunded = lines.some((l) => l.status === "refunded");

  let status: "paid" | "partial_released" | "fully_released" | "partial_refunded" | "fully_refunded";
  if (hasPending) {
    status = hasReleased || hasRefunded ? "partial_released" : "paid";
  } else if (hasReleased && !hasRefunded) {
    status = "fully_released";
  } else if (hasRefunded && !hasReleased) {
    status = "fully_refunded";
  } else {
    status = "partial_released";
  }
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status },
  });
  return status;
}
