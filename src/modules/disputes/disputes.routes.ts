import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { disputesController } from "./disputes.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/", disputesController.open);
router.get("/me", disputesController.listMine);
router.get("/:id", disputesController.getById);
router.patch("/:id/resolve", requireRole("admin"), disputesController.resolve);

export default router;
