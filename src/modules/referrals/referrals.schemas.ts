import { z } from "zod";

export const claimSchema = z.object({
  code: z.string().min(1).max(80),
});

export const codeParam = z.object({
  code: z.string().min(1).max(80),
});

export type ClaimReferralInput = z.infer<typeof claimSchema>;
