import { Router } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { idempotencyGuard } from "../../middleware/idempotency.js";
import { boostsController } from "./boosts.controller.js";

const router = Router();

router.get("/boosts/plans", boostsController.listPlans);
router.post("/boosts", requireAuth, idempotencyGuard, boostsController.buy);
router.get("/boosts/me", requireAuth, boostsController.listMine);
router.get(
  "/products/:id/boost",
  optionalAuth,
  boostsController.getProductBoost,
);
router.get(
  "/shops/:id/boosts",
  optionalAuth,
  boostsController.listShopBoosts,
);

export default router;
