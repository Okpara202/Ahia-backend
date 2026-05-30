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
    const line = await prisma.invoiceLine.findUnique({
      where: { id: input.invoiceLineId },
      include: {
        invoice: { select: { buyerId: true, sellerId: true } },
        product: { select: { id: true, shopId: true } },
      },
    });
    if (!line) throw new NotFoundError("Invoice line");
    if (line.kind !== "product" || !line.product) {
      throw new BadRequestError("Only product lines can be reviewed");
    }
    if (line.invoice.buyerId !== userId) {
      throw new ForbiddenError("Only the buyer can review this line");
    }
    if (line.invoice.sellerId === userId) {
      throw new AppError(400, "self_review", "You can't review your own product.");
    }
    if (line.status !== "released") {
      throw new BadRequestError("Can only review lines that have been released");
    }

    const existing = await reviewsRepo.findByInvoiceLineId(input.invoiceLineId);
    if (existing) {
      throw new ConflictError("REVIEW_EXISTS", "Line already reviewed");
    }

    return reviewsRepo.create({
      invoiceLine: { connect: { id: input.invoiceLineId } },
      product: { connect: { id: line.product.id } },
      shop: { connect: { id: line.product.shopId } },
      author: { connect: { id: userId } },
      rating: input.rating,
      body: input.body,
    });
  },
};
