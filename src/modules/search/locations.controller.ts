import type { Request, Response } from "express";
import { prisma } from "../../config/db.js";

export const locationsController = {
  async list(_req: Request, res: Response) {
    const rows = await prisma.shop.findMany({
      where: {
        owner: { role: "seller" },
        location: { not: null },
      },
      select: { location: true },
      distinct: ["location"],
      orderBy: { location: "asc" },
    });
    const locations = rows
      .map((r) => r.location)
      .filter((l): l is string => l !== null);
    res.status(200).json({ locations });
  },
};
