import { logger } from "../../config/logger.js";
import { redis } from "../../integrations/redis.js";

const ONLINE_TTL_SECONDS = 30;

function onlineKey(userId: string) {
  return `presence:user:${userId}`;
}

function lastSeenKey(userId: string) {
  return `presence:lastseen:${userId}`;
}

export const presenceService = {
  async isOnline(userId: string): Promise<boolean> {
    if (!redis) return false;
    try {
      const val = await redis.get(onlineKey(userId));
      return val !== null;
    } catch (err) {
      logger.warn("presence: isOnline lookup failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  async bulkOnline(userIds: string[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (userIds.length === 0 || !redis) {
      for (const id of userIds) map.set(id, false);
      return map;
    }
    try {
      const keys = userIds.map(onlineKey);
      const values = await redis.mget(...keys);
      userIds.forEach((id, i) => map.set(id, values[i] !== null));
    } catch (err) {
      logger.warn("presence: bulkOnline lookup failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      for (const id of userIds) map.set(id, false);
    }
    return map;
  },

  async lastSeenAt(userId: string): Promise<Date | null> {
    if (!redis) return null;
    try {
      const value = await redis.get(lastSeenKey(userId));
      return value ? new Date(Number(value)) : null;
    } catch (err) {
      logger.warn("presence: lastSeenAt lookup failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  async markOnline(userId: string): Promise<{ wasOffline: boolean }> {
    if (!redis) return { wasOffline: true };
    try {
      const set = await redis.set(
        onlineKey(userId),
        "1",
        "EX",
        ONLINE_TTL_SECONDS,
        "NX",
      );
      // SET ... NX returns "OK" when the key was newly set (transition from offline)
      return { wasOffline: set === "OK" };
    } catch (err) {
      logger.warn("presence: markOnline failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      return { wasOffline: true };
    }
  },

  async refreshOnline(userId: string): Promise<void> {
    if (!redis) return;
    try {
      await redis.set(onlineKey(userId), "1", "EX", ONLINE_TTL_SECONDS);
    } catch (err) {
      logger.warn("presence: refreshOnline failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async markOffline(userId: string): Promise<void> {
    if (!redis) return;
    try {
      const now = Date.now();
      await Promise.all([
        redis.del(onlineKey(userId)),
        redis.set(lastSeenKey(userId), String(now), "EX", 60 * 60 * 24 * 30),
      ]);
    } catch (err) {
      logger.warn("presence: markOffline failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async getState(userId: string): Promise<{ online: boolean; lastSeenAt: string | null }> {
    const [online, lastSeen] = await Promise.all([
      this.isOnline(userId),
      this.lastSeenAt(userId),
    ]);
    return {
      online,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
    };
  },
};
