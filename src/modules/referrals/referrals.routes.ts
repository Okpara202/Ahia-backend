import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { referralsController } from "./referrals.controller.js";

const router = Router();

router.get("/referrals/me", requireAuth, referralsController.getMine);
router.post("/referrals/claim", requireAuth, referralsController.claim);
router.get("/r/:code", referralsController.redirect);

export default router;
