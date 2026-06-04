// Per-type notification renderers. Each returns the ready-to-display {title, body, link}
// plus the raw payload kept for the frontend to consume programmatically if needed.

type Rendered = {
  type: string;
  title: string;
  body: string;
  link: string | null;
  payload: Record<string, unknown>;
};

function formatNaira(amount: number | string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return new Intl.NumberFormat("en-NG").format(n);
}

function summarizeLines(lines: Array<{ name: string; kind: string }>): string {
  const item = lines.filter((l) => l.kind !== "discount");
  if (item.length === 0) return "Items";
  if (item.length === 1) return item[0]!.name;
  if (item.length === 2) return `${item[0]!.name} + ${item[1]!.name}`;
  return `${item.length} items`;
}

export const notificationRenderers = {
  invoiceReceived(args: {
    sellerName: string;
    itemSummary: string;
    total: number | string;
    conversationId: string;
    invoiceId: string;
  }): Rendered {
    return {
      type: "invoice_received",
      title: `${args.sellerName} sent an invoice`,
      body: `${args.itemSummary} · ₦${formatNaira(args.total)} · Open the chat to pay.`,
      link: `/inbox/${args.conversationId}`,
      payload: {
        invoiceId: args.invoiceId,
        conversationId: args.conversationId,
        totalAmount: args.total,
      },
    };
  },

  invoicePaid(args: {
    total: number | string;
    conversationId: string;
    invoiceId: string;
  }): Rendered {
    return {
      type: "invoice_paid",
      title: "Payment received",
      body: `Your ₦${formatNaira(args.total)} is held safely. We'll release each line as you confirm delivery.`,
      link: `/inbox/${args.conversationId}`,
      payload: { invoiceId: args.invoiceId, amount: args.total },
    };
  },

  invoiceReceivedPayment(args: {
    buyerName: string;
    total: number | string;
    conversationId: string;
    invoiceId: string;
  }): Rendered {
    return {
      type: "invoice_received_payment",
      title: `${args.buyerName} paid you`,
      body: `Invoice ₦${formatNaira(args.total)} · funds are held in escrow until they confirm each line.`,
      link: `/seller/inbox/${args.conversationId}`,
      payload: { invoiceId: args.invoiceId, amount: args.total },
    };
  },

  invoiceLineReleased(args: {
    buyerName: string;
    lineName: string;
    amount: number | string;
    conversationId: string;
    invoiceId: string;
    lineId: string;
    autoReleased?: boolean;
  }): Rendered {
    const title = `₦${formatNaira(args.amount)} released to you`;
    const body = args.autoReleased
      ? `Auto-released after 7 days · ${args.lineName}. Funds added to your payout balance.`
      : `${args.buyerName} confirmed ${args.lineName}. Funds added to your payout balance.`;
    return {
      type: "invoice_line_released",
      title,
      body,
      link: `/seller/inbox/${args.conversationId}`,
      payload: {
        invoiceId: args.invoiceId,
        lineId: args.lineId,
        amount: args.amount,
      },
    };
  },

  invoiceLineDisputed(args: {
    buyerName: string;
    lineName: string;
    amount: number | string;
    conversationId: string;
    invoiceId: string;
    lineId: string;
    disputeId: string;
  }): Rendered {
    return {
      type: "invoice_line_disputed",
      title: `${args.buyerName} opened a dispute`,
      body: `${args.lineName} · ₦${formatNaira(args.amount)} · An admin will review the chat history.`,
      link: `/seller/inbox/${args.conversationId}`,
      payload: {
        invoiceId: args.invoiceId,
        lineId: args.lineId,
        disputeId: args.disputeId,
      },
    };
  },

  invoiceLineExtended(args: {
    buyerName: string;
    lineName: string;
    amount: number | string;
    conversationId: string;
    invoiceId: string;
    lineId: string;
    autoReleaseAt: string;
    extensionReason: string;
  }): Rendered {
    return {
      type: "invoice_line_extended",
      title: `${args.buyerName} extended the review window`,
      body: `${args.lineName} · ₦${formatNaira(args.amount)} · auto-releases in 7d · reason: '${args.extensionReason}'`,
      link: `/seller/inbox/${args.conversationId}`,
      payload: {
        invoiceId: args.invoiceId,
        lineId: args.lineId,
        autoReleaseAt: args.autoReleaseAt,
        extensionReason: args.extensionReason,
      },
    };
  },

  disputeResolved(args: {
    recipient: "buyer" | "seller";
    lineName: string;
    amount: number | string;
    conversationId: string;
    invoiceId: string;
    lineId: string;
    disputeId: string;
    resolution: "released_to_seller" | "refunded_to_buyer";
  }): Rendered {
    const resolutionWord = args.resolution === "released_to_seller" ? "Released" : "Refunded";
    const blurb =
      args.resolution === "released_to_seller"
        ? "Admin sided with the seller. Funds released."
        : "Admin sided with the buyer. You've been refunded.";
    const link =
      args.recipient === "seller"
        ? `/seller/inbox/${args.conversationId}`
        : `/inbox/${args.conversationId}`;
    return {
      type: "dispute_resolved",
      title: `Dispute resolved — ${resolutionWord}`,
      body: `${args.lineName} · ₦${formatNaira(args.amount)} · ${blurb}`,
      link,
      payload: {
        disputeId: args.disputeId,
        lineId: args.lineId,
        invoiceId: args.invoiceId,
        resolution: args.resolution,
      },
    };
  },

  boostPurchased(args: {
    productName: string;
    endsAt: string | Date;
    productId: string;
    boostId: string;
  }): Rendered {
    const endsStr =
      typeof args.endsAt === "string" ? args.endsAt : args.endsAt.toISOString();
    const friendly = new Date(endsStr).toLocaleDateString("en-NG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return {
      type: "boost_purchased",
      title: "Boost active",
      body: `${args.productName} is now boosted in the feed until ${friendly}.`,
      link: "/seller/products",
      payload: {
        productId: args.productId,
        boostId: args.boostId,
        endsAt: endsStr,
      },
    };
  },

  discoverCampaignStarted(args: { campaignId: string }): Rendered {
    return {
      type: "discover_campaign_started",
      title: "Ad campaign live",
      body: "Your video is now playing in the Discover feed.",
      link: `/seller/ads/${args.campaignId}`,
      payload: { campaignId: args.campaignId },
    };
  },

  referralCompleted(args: {
    inviteeName: string;
    rewardNaira: number;
    referralId: string;
  }): Rendered {
    return {
      type: "referral_completed",
      title: `₦${formatNaira(args.rewardNaira)} referral bonus earned`,
      body: `${args.inviteeName} completed their first sale. Credit added to your wallet.`,
      link: "/profile",
      payload: { referralId: args.referralId, reward: args.rewardNaira },
    };
  },

  storyPosted(args: {
    shopHandle: string;
    shopId: string;
    storyId: string;
    caption: string | null;
  }): Rendered {
    const body = (args.caption ?? "Tap to see what's new.").slice(0, 80);
    return {
      type: "story_posted",
      title: `@${args.shopHandle} posted a new drop`,
      body,
      link: `/shops/${args.shopId}`,
      payload: { shopId: args.shopId, storyId: args.storyId },
    };
  },

  payoutSettled(args: { amount: number; sellerId: string; payoutId: string }): Rendered {
    return {
      type: "payout_settled",
      title: `₦${formatNaira(args.amount)} paid out`,
      body: "Landing in your bank account shortly. Track it in your payout history.",
      link: "/seller/payouts",
      payload: {
        amount: args.amount,
        sellerId: args.sellerId,
        payoutId: args.payoutId,
      },
    };
  },

  payoutAwaitingAccount(args: { amount: number; sellerId: string }): Rendered {
    return {
      type: "payout_awaiting_account",
      title: `₦${formatNaira(args.amount)} ready to pay out`,
      body: "Add your payout account to receive this — until you do, daily sweep skips you.",
      link: "/seller/shop",
      payload: { amount: args.amount, sellerId: args.sellerId },
    };
  },

  followReceived(args: {
    followerName: string;
    followerHandle: string | null;
    followerId: string;
    shopId: string;
  }): Rendered {
    const display = args.followerHandle
      ? `@${args.followerHandle}`
      : args.followerName;
    return {
      type: "follow",
      title: `${display} followed your shop`,
      body: "Open your followers list to say hi.",
      link: "/seller/shop/followers",
      payload: {
        followerId: args.followerId,
        followerHandle: args.followerHandle,
        followerName: args.followerName,
        shopId: args.shopId,
      },
    };
  },

  shopReopened(args: { shopName: string; shopHandle: string; shopId: string }): Rendered {
    return {
      type: "shop_reopened",
      title: `${args.shopName} is back open`,
      body: "Browse their latest.",
      link: `/shops/${args.shopId}`,
      payload: {
        shopId: args.shopId,
        shopName: args.shopName,
        shopHandle: args.shopHandle,
      },
    };
  },
};

export { summarizeLines };
