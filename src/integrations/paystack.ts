import axios from "axios";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { InternalError } from "../errors.js";

function requireKey(): string {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new InternalError("Paystack not configured (PAYSTACK_SECRET_KEY missing)");
  }
  return env.PAYSTACK_SECRET_KEY;
}

const client = axios.create({ baseURL: "https://api.paystack.co" });

client.interceptors.request.use((config) => {
  config.headers.set("Authorization", `Bearer ${requireKey()}`);
  return config;
});

type InitTransactionArgs = {
  email: string;
  amountInKobo: number;
  reference: string;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
};

type InitTransactionResponse = {
  authorization_url: string;
  reference: string;
  access_code: string;
};

export const paystack = {
  async initTransaction(args: InitTransactionArgs): Promise<InitTransactionResponse> {
    const res = await client.post<{ data: InitTransactionResponse }>(
      "/transaction/initialize",
      {
        email: args.email,
        amount: args.amountInKobo,
        reference: args.reference,
        metadata: args.metadata,
        callback_url: args.callbackUrl,
      },
    );
    return res.data.data;
  },

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const computed = crypto
      .createHmac("sha512", requireKey())
      .update(rawBody)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
    } catch {
      return false;
    }
  },
};
