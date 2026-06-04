import { logger } from "../config/logger.js";
import { storiesBackground } from "../modules/stories/stories.service.js";

const TICK_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  try {
    await storiesBackground.sweepExpired();
  } catch (err) {
    logger.error("storyExpiry: tick failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startStoryExpiry() {
  if (timer) return;
  void runOnce();
  timer = setInterval(() => void runOnce(), TICK_MS);
  logger.info("storyExpiry: scheduled", { everyMs: TICK_MS });
}

export function stopStoryExpiry() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
