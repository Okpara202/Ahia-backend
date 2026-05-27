import Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 10_000,
      maxRetriesPerRequest: 3,
      retryStrategy: (attempts) => Math.min(attempts * 200, 2_000),
    })
  : null;

if (redis) {
  redis.on("connect", () => logger.info("redis: socket connected"));
  redis.on("ready", () => logger.info("redis: ready"));
  redis.on("error", (err: Error) => logger.error("redis: error", { message: err.message }));
  redis.on("reconnecting", (delayMs: number) =>
    logger.warn("redis: reconnecting", { delayMs }),
  );
  redis.on("close", () => logger.warn("redis: connection closed"));
  redis.on("end", () => logger.warn("redis: connection ended"));
}

export async function pingRedis(): Promise<boolean> {
  if (!redis) {
    logger.warn("redis: REDIS_URL not set — Socket.io multi-instance, cache, and online-status disabled");
    return false;
  }
  try {
    await redis.connect();
    const pong = await redis.ping();
    logger.info("redis: ping ok", { pong });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("redis: ping failed — check REDIS_URL", { message });
    return false;
  }
}
