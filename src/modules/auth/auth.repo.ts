import { prisma } from "../../config/db.js";
import type { Prisma, User } from "@prisma/client";

export const authRepo = {
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  findByGoogleId(googleId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { googleId } });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  linkGoogleId(userId: string, googleId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { googleId },
    });
  },
};
