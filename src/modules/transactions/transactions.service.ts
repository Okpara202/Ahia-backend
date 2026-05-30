import { ForbiddenError, NotFoundError } from "../../errors.js";
import { transactionsRepo } from "./transactions.repo.js";
import type { ListTransactionsQuery } from "./transactions.schemas.js";

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

async function assertParticipant(id: string, userId: string) {
  const txn = await transactionsRepo.findById(id);
  if (!txn) throw new NotFoundError("Transaction");
  if (txn.buyerId !== userId && txn.sellerId !== userId) {
    throw new ForbiddenError("Not a participant in this transaction");
  }
  return txn;
}

export const transactionsService = {
  async listMine(userId: string, query: ListTransactionsQuery) {
    const rows = await transactionsRepo.listForBuyer({
      buyerId: userId,
      take: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return paginate(rows, query.limit);
  },

  async listSales(userId: string, query: ListTransactionsQuery) {
    const rows = await transactionsRepo.listForSeller({
      sellerId: userId,
      take: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return paginate(rows, query.limit);
  },

  async getById(userId: string, id: string) {
    return assertParticipant(id, userId);
  },

  async getByReference(userId: string, reference: string) {
    const txn = await transactionsRepo.findByReference(reference);
    if (!txn) throw new NotFoundError("Transaction");
    if (txn.buyerId !== userId && txn.sellerId !== userId) {
      throw new ForbiddenError("Not a participant in this transaction");
    }
    return txn;
  },
};
