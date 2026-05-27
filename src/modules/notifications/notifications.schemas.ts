import { z } from "zod";

const stringBool = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => (typeof v === "boolean" ? v : v === "true"));

export const listNotificationsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unreadOnly: stringBool.optional(),
});

export const notificationIdParam = z.object({
  id: z.string().uuid(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
