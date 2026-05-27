import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { storiesController } from "./stories.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get("/shops/:id/stories", storiesController.listForShop);
router.post(
  "/shops/me/stories",
  requireAuth,
  upload.single("image"),
  storiesController.create,
);

export default router;
