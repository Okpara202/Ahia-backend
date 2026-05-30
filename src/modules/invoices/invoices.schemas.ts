import { z } from "zod";

const positiveAmount = z.coerce.number().positive().max(10_000_000);
const negativeAmount = z.coerce.number().lt(0).gte(-10_000_000);

const productLineSchema = z.object({
  kind: z.literal("product"),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
});

const customLineSchema = z.object({
  kind: z.literal("custom"),
  name: z.string().min(1).max(120),
  unitPrice: positiveAmount,
  quantity: z.coerce.number().int().min(1).max(99).default(1),
});

const discountLineSchema = z.object({
  kind: z.literal("discount"),
  name: z.string().min(1).max(120),
  unitPrice: negativeAmount,
});

export const invoiceLineInputSchema = z.discriminatedUnion("kind", [
  productLineSchema,
  customLineSchema,
  discountLineSchema,
]);

export const createInvoiceSchema = z.object({
  lines: z.array(invoiceLineInputSchema).min(1).max(40),
});

export const payInvoiceSchema = z.object({
  callbackUrl: z.string().url().optional(),
});

export const invoiceIdParam = z.object({
  invoiceId: z.string().uuid(),
});

export const conversationInvoiceParam = z.object({
  id: z.string().uuid(),
});

export const lineIdParam = z.object({
  lineId: z.string().uuid(),
});

export const disputeLineSchema = z.object({
  reason: z.string().min(5).max(2000),
  evidenceUrl: z.string().url().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;
export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>;
export type DisputeLineInput = z.infer<typeof disputeLineSchema>;
