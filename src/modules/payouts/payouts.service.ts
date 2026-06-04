import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { AppError, NotFoundError } from "../../errors.js";
import { paystack } from "../../integrations/paystack.js";
import { redis } from "../../integrations/redis.js";
import type {
  ResolveAccountQuery,
  SavePayoutAccountInput,
} from "./payouts.schemas.js";

const BANKS_CACHE_KEY = "paystack:banks:ng";
const BANKS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const RESOLVE_CACHE_TTL_SECONDS = 60;

function resolveCacheKey(bankCode: string, accountNumber: string) {
  return `paystack:resolve:${bankCode}:${accountNumber}`;
}

let inMemoryBanksCache: { ts: number; banks: Array<{ code: string; name: string }> } | null = null;

export const payoutsService = {
  async listBanks() {
    if (redis) {
      try {
        const cached = await redis.get(BANKS_CACHE_KEY);
        if (cached) return JSON.parse(cached) as Array<{ code: string; name: string }>;
      } catch (err) {
        logger.warn("payouts: banks cache read failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (inMemoryBanksCache && Date.now() - inMemoryBanksCache.ts < BANKS_CACHE_TTL_SECONDS * 1000) {
      return inMemoryBanksCache.banks;
    }

    const banks = await paystack.listBanks();

    if (redis) {
      try {
        await redis.set(BANKS_CACHE_KEY, JSON.stringify(banks), "EX", BANKS_CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn("payouts: banks cache write failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      inMemoryBanksCache = { ts: Date.now(), banks };
    }
    return banks;
  },

  async resolveAccount(query: ResolveAccountQuery) {
    const key = resolveCacheKey(query.bankCode, query.accountNumber);
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) return { accountName: cached };
      } catch (err) {
        logger.warn("payouts: resolve cache read failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      const result = await paystack.resolveAccount(query);
      if (redis) {
        try {
          await redis.set(key, result.accountName, "EX", RESOLVE_CACHE_TTL_SECONDS);
        } catch (err) {
          logger.warn("payouts: resolve cache write failed", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return result;
    } catch (err) {
      logger.warn("payouts: resolve failed", {
        bankCode: query.bankCode,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        400,
        "invalid_account",
        "Could not verify that account. Check the bank and number, then try again.",
      );
    }
  },

  async getMine(userId: string) {
    const account = await prisma.payoutAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        bankCode: true,
        accountNumber: true,
        accountName: true,
        createdAt: true,
        updatedAt: true,
        paystackRecipientCode: true,
      },
    });
    if (!account) return null;
    return {
      id: account.id,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      hasRecipient: !!account.paystackRecipientCode,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  },

  async save(userId: string, input: SavePayoutAccountInput) {
    const { accountName } = await this.resolveAccount(input);

    let recipientCode: string;
    try {
      const recipient = await paystack.createTransferRecipient({
        name: accountName,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      });
      recipientCode = recipient.recipientCode;
    } catch (err) {
      logger.error("payouts: recipient creation failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        502,
        "PAYSTACK_RECIPIENT_FAILED",
        "Couldn't register your payout account with Paystack. Try again in a moment.",
      );
    }

    const existing = await prisma.payoutAccount.findUnique({
      where: { userId },
      select: { paystackRecipientCode: true },
    });
    if (existing?.paystackRecipientCode && existing.paystackRecipientCode !== recipientCode) {
      try {
        await paystack.deleteTransferRecipient(existing.paystackRecipientCode);
      } catch (err) {
        logger.warn("payouts: stale recipient delete failed", {
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const saved = await prisma.payoutAccount.upsert({
      where: { userId },
      update: {
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName,
        paystackRecipientCode: recipientCode,
      },
      create: {
        userId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName,
        paystackRecipientCode: recipientCode,
      },
    });

    return {
      id: saved.id,
      bankCode: saved.bankCode,
      accountNumber: saved.accountNumber,
      accountName: saved.accountName,
      hasRecipient: true,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  },

  async remove(userId: string) {
    const existing = await prisma.payoutAccount.findUnique({
      where: { userId },
      select: { paystackRecipientCode: true },
    });
    if (!existing) throw new NotFoundError("Payout account");
    if (existing.paystackRecipientCode) {
      try {
        await paystack.deleteTransferRecipient(existing.paystackRecipientCode);
      } catch (err) {
        logger.warn("payouts: recipient delete failed", {
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await prisma.payoutAccount.delete({ where: { userId } });
  },
};
