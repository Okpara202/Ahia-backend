import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { pingRedis, redis } from "./integrations/redis.js";
import { initSocket } from "./realtime/socket.js";
import { startEscrowAutoRelease, stopEscrowAutoRelease } from "./jobs/escrowAutoRelease.js";
import { startBoostExpiry, stopBoostExpiry } from "./jobs/boostExpiry.js";
import { startStoryExpiry, stopStoryExpiry } from "./jobs/storyExpiry.js";
import { startPayoutSweep, stopPayoutSweep } from "./jobs/payoutSweep.js";
import { startPaystackRecovery, stopPaystackRecovery } from "./jobs/paystackRecovery.js";

const app = createApp();
const httpServer = createServer(app);

initSocket(httpServer);

const server = httpServer.listen(env.PORT, () => {
  logger.info(`ahia-backend listening on http://localhost:${env.PORT}`, {
    env: env.NODE_ENV,
  });
  void pingRedis();
  startEscrowAutoRelease();
  startBoostExpiry();
  startStoryExpiry();
  startPayoutSweep();
  startPaystackRecovery();
});

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down`);
  stopEscrowAutoRelease();
  stopBoostExpiry();
  stopStoryExpiry();
  stopPayoutSweep();
  stopPaystackRecovery();
  server.close(() => {
    void redis?.quit().finally(() => process.exit(0));
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason });
});

process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { message: err.message, stack: err.stack });
  process.exit(1);
});
