import { logger } from "../config/logger.js";
import { boostsBackground } from "../modules/boosts/boosts.service.js";

const TICK_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  await boostsBackground.expireStaleSponsoredFlags();
}

export function startBoostExpiry() {
  if (timer) return;
  void runOnce().catch((err) =>
    logger.error("boost expiry: initial run failed", {
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  timer = setInterval(() => {
    void runOnce().catch((err) =>
      logger.error("boost expiry: tick failed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, TICK_MS);
  logger.info("boost expiry: scheduled", { everyMs: TICK_MS });
}

export function stopBoostExpiry() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
