import { logger } from "../config/logger.js";
import { transactionsRepo } from "../modules/transactions/transactions.repo.js";
import { transactionsBackground } from "../modules/transactions/transactions.service.js";

const AUTO_RELEASE_DAYS = 7;
const TICK_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  const eligible = await transactionsRepo.findEligibleForAutoRelease(
    new Date(),
    AUTO_RELEASE_DAYS,
  );
  if (eligible.length === 0) return;
  logger.info("escrow auto-release: processing batch", { count: eligible.length });
  for (const txn of eligible) {
    try {
      await transactionsBackground.releaseEscrow(txn.id);
    } catch (err) {
      logger.error("escrow auto-release: failed", {
        transactionId: txn.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startEscrowAutoRelease() {
  if (timer) return;
  void runOnce().catch((err) =>
    logger.error("escrow auto-release: initial run failed", {
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  timer = setInterval(() => {
    void runOnce().catch((err) =>
      logger.error("escrow auto-release: tick failed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, TICK_MS);
  logger.info("escrow auto-release: scheduled", { everyMs: TICK_MS, days: AUTO_RELEASE_DAYS });
}

export function stopEscrowAutoRelease() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
