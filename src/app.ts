import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { generalLimiter } from "./middleware/rateLimit.js";
import { requestLogger } from "./middleware/requestLogger.js";
import authRoutes from "./modules/auth/auth.routes.js";
import googleOauthRoutes from "./modules/auth/oauth/google.js";
import productsRoutes from "./modules/products/products.routes.js";
import shopsRoutes from "./modules/shops/shops.routes.js";
import conversationsRoutes from "./modules/conversations/conversations.routes.js";
import wishlistRoutes from "./modules/wishlist/wishlist.routes.js";
import notificationsRoutes from "./modules/notifications/notifications.routes.js";
import reviewsRoutes from "./modules/reviews/reviews.routes.js";
import transactionsRoutes from "./modules/transactions/transactions.routes.js";
import disputesRoutes from "./modules/disputes/disputes.routes.js";
import boostsRoutes from "./modules/boosts/boosts.routes.js";
import discoverRoutes from "./modules/discover/discover.routes.js";
import storiesRoutes from "./modules/stories/stories.routes.js";
import referralsRoutes from "./modules/referrals/referrals.routes.js";
import webhooksRoutes from "./modules/webhooks/webhooks.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import paymentsRoutes from "./modules/payments/payments.routes.js";
import searchRoutes from "./modules/search/search.routes.js";
import { productsController } from "./modules/products/products.controller.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(requestLogger);

  // Webhooks mounted BEFORE express.json so handlers can read the raw body
  // for HMAC signature verification. Also exempted from the rate limiter below.
  app.use("/webhooks", webhooksRoutes);

  app.use(express.json({ limit: "1mb" }));
  app.use(generalLimiter);

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/auth", authRoutes);
  app.use("/auth/google", googleOauthRoutes);
  app.use("/products", productsRoutes);
  app.use("/shops", shopsRoutes);
  app.use("/conversations", conversationsRoutes);
  app.use("/wishlist", wishlistRoutes);
  app.use("/notifications", notificationsRoutes);
  app.use("/transactions", transactionsRoutes);
  app.use("/disputes", disputesRoutes);
  app.use("/boosts", boostsRoutes);
  app.use("/discover", discoverRoutes);
  app.use("/users", usersRoutes);
  app.use("/payments", paymentsRoutes);
  app.get("/feed", productsController.list);
  app.use(searchRoutes);
  app.use(reviewsRoutes);
  app.use(storiesRoutes);
  app.use(referralsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
