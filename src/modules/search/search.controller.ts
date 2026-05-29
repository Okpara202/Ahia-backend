import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { productsService } from "../products/products.service.js";

const searchQuery = z.object({
  q: z.string().optional(),
  type: z.enum(["products", "shops"]).default("products"),
  category: z.string().optional(),
  location: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const searchController = {
  async search(req: Request, res: Response) {
    const query = searchQuery.parse(req.query);

    if (query.type === "shops") {
      const baseWhere = {
        owner: { role: "seller" as const },
        ...(query.location ? { location: query.location } : {}),
      };
      const items = query.q
        ? await prisma.shop.findMany({
            where: {
              ...baseWhere,
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { handle: { contains: query.q, mode: "insensitive" } },
                { bio: { contains: query.q, mode: "insensitive" } },
              ],
            },
            take: query.limit,
            orderBy: { createdAt: "desc" },
          })
        : await prisma.shop.findMany({
            where: baseWhere,
            take: query.limit,
            orderBy: { createdAt: "desc" },
          });
      res.status(200).json({ items, nextCursor: null });
      return;
    }

    const result = await productsService.list({
      q: query.q,
      category: query.category,
      location: query.location,
      cursor: query.cursor,
      limit: query.limit,
    });
    res.status(200).json(result);
  },
};
