import { logger } from "../config/logger.js";
import { payoutSweep } from "../modules/payouts/payouts.sweep.js";

// Check every 5 min; trigger when Lagos local hour is 6 and we haven't run
// for today's date yet (idempotency at the DB level handles duplicates).
const TICK_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null;

function lagosDateString(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function lagosHour(): number {
  const hourStr = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    hour12: false,
  });
  return Number(hourStr.replace(/[^\d]/g, ""));
}

async function tick() {
  const today = lagosDateString();
  if (lastRunDate === today) return;
  const hour = lagosHour();
  if (hour < 6) return;

  logger.info("payoutSweep: triggering daily sweep", { date: today, lagosHour: hour });
  try {
    const result = await payoutSweep.sweepNow();
    lastRunDate = today;
    logger.info("payoutSweep: completed", { date: today, ...result });
  } catch (err) {
    logger.error("payoutSweep: failed", {
      date: today,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startPayoutSweep() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  logger.info("payoutSweep: scheduled", { everyMs: TICK_MS });
}

export function stopPayoutSweep() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
