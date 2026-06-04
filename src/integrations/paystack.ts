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

  async listBanks(): Promise<Array<{ code: string; name: string }>> {
    const res = await client.get<{
      data: Array<{ code: string; name: string }>;
    }>("/bank?country=nigeria&perPage=200");
    return res.data.data.map((b) => ({ code: b.code, name: b.name }));
  },

  async resolveAccount(args: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ accountName: string }> {
    const res = await client.get<{
      status: boolean;
      message: string;
      data: { account_name: string };
    }>(
      `/bank/resolve?account_number=${encodeURIComponent(args.accountNumber)}&bank_code=${encodeURIComponent(args.bankCode)}`,
    );
    return { accountName: res.data.data.account_name };
  },

  async createTransferRecipient(args: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{ recipientCode: string }> {
    const res = await client.post<{
      data: { recipient_code: string };
    }>("/transferrecipient", {
      type: "nuban",
      name: args.name,
      account_number: args.accountNumber,
      bank_code: args.bankCode,
      currency: "NGN",
    });
    return { recipientCode: res.data.data.recipient_code };
  },

  async deleteTransferRecipient(recipientCode: string): Promise<void> {
    await client.delete(`/transferrecipient/${encodeURIComponent(recipientCode)}`);
  },

  async initiateRefund(args: {
    transactionReference: string;
    amountInKobo: number;
  }): Promise<{ refundId: string; status: string; raw: unknown }> {
    const res = await client.post<{
      data: { id: number; status: string };
    }>("/refund", {
      transaction: args.transactionReference,
      amount: args.amountInKobo,
    });
    return {
      refundId: String(res.data.data.id),
      status: res.data.data.status,
      raw: res.data,
    };
  },

  async initiateTransfer(args: {
    amountInKobo: number;
    recipientCode: string;
    reason: string;
    reference: string;
  }): Promise<{
    transferCode: string;
    transferReference: string;
    status: string;
    raw: unknown;
  }> {
    const res = await client.post<{
      data: {
        transfer_code: string;
        reference: string;
        status: string;
      };
    }>("/transfer", {
      source: "balance",
      amount: args.amountInKobo,
      recipient: args.recipientCode,
      reason: args.reason,
      reference: args.reference,
    });
    return {
      transferCode: res.data.data.transfer_code,
      transferReference: res.data.data.reference,
      status: res.data.data.status,
      raw: res.data,
    };
  },

  async verifyTransaction(reference: string): Promise<{
    status: "success" | "failed" | "abandoned" | "pending" | string;
    amount: number;
    metadata?: { type?: string; [k: string]: unknown };
    raw: unknown;
  }> {
    const res = await client.get<{
      data: {
        status: string;
        amount: number;
        metadata?: { type?: string; [k: string]: unknown };
      };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: res.data.data.status,
      amount: res.data.data.amount,
      metadata: res.data.data.metadata,
      raw: res.data,
    };
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
