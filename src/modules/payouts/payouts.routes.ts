import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { payoutsController } from "./payouts.controller.js";

const router = Router();

router.get("/paystack/banks", requireAuth, payoutsController.listBanks);
router.get(
  "/paystack/resolve-account",
  requireAuth,
  payoutsController.resolveAccount,
);
router.get("/payout-accounts/me", requireAuth, payoutsController.getMine);
router.post("/payout-accounts/me", requireAuth, payoutsController.save);
router.delete("/payout-accounts/me", requireAuth, payoutsController.remove);

router.get("/seller/payouts", requireAuth, payoutsController.listMyPayouts);
router.get(
  "/seller/payouts/cash-out-now/preview",
  requireAuth,
  payoutsController.cashOutPreview,
);
router.post(
  "/seller/payouts/cash-out-now",
  requireAuth,
  payoutsController.cashOutExecute,
);

export default router;
