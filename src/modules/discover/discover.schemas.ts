import { z } from "zod";

export const createDiscoverPostSchema = z.object({
  caption: z.string().max(500).optional(),
  ctaType: z.enum(["product", "shop"]),
  ctaTargetId: z.string().uuid(),
  intent: z.enum(["free", "boost"]).default("free"),
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

export const listMyPostsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const editPostSchema = z.object({
  caption: z.string().max(500).optional(),
});

export const EDITABLE_POST_BODY_KEYS = new Set(["caption"]);
export const EDITABLE_POST_FILE_KEYS = new Set(["poster"]);

export type CreateDiscoverPostInput = z.infer<typeof createDiscoverPostSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type FeedQuery = z.infer<typeof feedQuery>;
export type ListMyPostsQuery = z.infer<typeof listMyPostsQuery>;
export type EditPostInput = z.infer<typeof editPostSchema>;
