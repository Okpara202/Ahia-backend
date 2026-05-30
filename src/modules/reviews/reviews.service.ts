import { prisma } from "../../config/db.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import { reviewsRepo } from "./reviews.repo.js";
import type { CreateReviewInput } from "./reviews.schemas.js";

export const reviewsService = {
  async listForProduct(productId: string) {
    const [reviews, agg] = await Promise.all([
      reviewsRepo.listForProduct(productId),
      reviewsRepo.productAggregate(productId),
    ]);
    return {
      reviews,
      average: agg._avg.rating ?? 0,
      count: agg._count,
    };
  },

  async shopRating(shopId: string) {
    const agg = await reviewsRepo.shopAggregate(shopId);
    return {
      average: agg._avg.rating ?? 0,
      count: agg._count,
    };
  },

  async create(userId: string, input: CreateReviewInput) {
    const txn = await prisma.transaction.findUnique({
      where: { id: input.transactionId },
      include: { product: { select: { shop: { select: { ownerId: true } } } } },
    });
    if (!txn) throw new NotFoundError("Transaction");
    if (txn.buyerId !== userId) {
      throw new ForbiddenError("Only the buyer can review this transaction");
    }
    if (txn.product.shop.ownerId === userId) {
      throw new AppError(400, "self_review", "You can't review your own product.");
    }
    if (txn.status !== "released") {
      throw new BadRequestError("Can only review transactions that have been released");
    }
    if (txn.productId !== input.productId) {
      throw new BadRequestError("Product mismatch for this transaction");
    }

    const existing = await reviewsRepo.findByTransactionId(input.transactionId);
    if (existing) {
      throw new ConflictError("REVIEW_EXISTS", "Transaction already reviewed");
    }

    return reviewsRepo.create({
      transaction: { connect: { id: input.transactionId } },
      product: { connect: { id: input.productId } },
      shop: { connect: { id: input.shopId } },
      author: { connect: { id: userId } },
      rating: input.rating,
      body: input.body,
    });
  },
};
