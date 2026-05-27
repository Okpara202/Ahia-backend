import { z } from "zod";

export const createDiscoverPostSchema = z.object({
  caption: z.string().max(500).optional(),
  ctaType: z.enum(["product", "shop"]),
  ctaTargetId: z.string().uuid(),
});

export const createCampaignSchema = z.object({
  postId: z.string().uuid(),
  plan: z.enum(["monthly", "quarterly", "biannual"]),
  callbackUrl: z.string().url().optional(),
});

export const postIdParam = z.object({
  id: z.string().uuid(),
});

export const campaignIdParam = z.object({
  id: z.string().uuid(),
});

export const feedQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type CreateDiscoverPostInput = z.infer<typeof createDiscoverPostSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type FeedQuery = z.infer<typeof feedQuery>;
