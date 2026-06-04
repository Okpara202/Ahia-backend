import { z } from "zod";

export const savePayoutAccountSchema = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, "Must be 10 digits"),
});

export const resolveAccountQuery = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, "Must be 10 digits"),
});

export type SavePayoutAccountInput = z.infer<typeof savePayoutAccountSchema>;
export type ResolveAccountQuery = z.infer<typeof resolveAccountQuery>;
