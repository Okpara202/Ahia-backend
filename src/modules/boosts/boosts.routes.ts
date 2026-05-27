import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { boostsController } from "./boosts.controller.js";

const router = Router();

router.get("/plans", boostsController.listPlans);
router.post("/", requireAuth, boostsController.buy);
router.get("/me", requireAuth, boostsController.listMine);

export default router;
