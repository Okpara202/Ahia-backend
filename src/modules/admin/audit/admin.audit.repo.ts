import { prisma } from "../../../config/db.js";
import type { Prisma } from "@prisma/client";

export const auditRepo = {
  list(args: {
    where: Prisma.AdminActionWhereInput;
    take: number;
    cursor?: string;
  }) {
    return prisma.adminAction.findMany({
      where: args.where,
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: {
        admin: { select: { id: true, name: true, email: true, role: true } },
      },
    });
  },
};
