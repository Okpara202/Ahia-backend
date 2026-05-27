import { prisma } from "../../config/db.js";
import { NotFoundError } from "../../errors.js";
import type { UpdateProfileInput, UpdateRoleInput } from "./users.schemas.js";

function publicUser<T extends { passwordHash: string | null }>(user: T) {
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

export const usersService = {
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
      },
    });
    if (!user) throw new NotFoundError("User");
    return publicUser(user);
  },

  async updateRole(userId: string, input: UpdateRoleInput) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: input.role },
    });
    if (!user) throw new NotFoundError("User");
    return publicUser(user);
  },
};
