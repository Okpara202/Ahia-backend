import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { paymentsController } from "./payments.controller.js";

const router = Router();

router.get("/verify/:reference", requireAuth, paymentsController.verify);

export default router;
