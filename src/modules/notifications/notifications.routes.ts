import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { notificationsController } from "./notifications.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", notificationsController.list);
router.post("/read-all", notificationsController.markAllRead);
router.patch("/read-all", notificationsController.markAllRead);
router.patch("/:id/read", notificationsController.markRead);

export default router;
