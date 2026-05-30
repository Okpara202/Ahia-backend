import { logger } from "../config/logger.js";
import { invoicesRepo } from "../modules/invoices/invoices.repo.js";
import { invoicesBackground } from "../modules/invoices/invoices.service.js";

const TICK_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  const eligible = await invoicesRepo.findLinesEligibleForAutoRelease(new Date());
  if (eligible.length === 0) return;
  logger.info("invoice line auto-release: processing batch", { count: eligible.length });
  for (const line of eligible) {
    try {
      await invoicesBackground.autoReleaseLine(line.id);
    } catch (err) {
      logger.error("invoice line auto-release: failed", {
        lineId: line.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startEscrowAutoRelease() {
  if (timer) return;
  void runOnce().catch((err) =>
    logger.error("invoice line auto-release: initial run failed", {
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  timer = setInterval(() => {
    void runOnce().catch((err) =>
      logger.error("invoice line auto-release: tick failed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, TICK_MS);
  logger.info("invoice line auto-release: scheduled", { everyMs: TICK_MS });
}

export function stopEscrowAutoRelease() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
