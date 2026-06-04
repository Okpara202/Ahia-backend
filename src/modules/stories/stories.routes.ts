import { Router } from "express";
import multer from "multer";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { storiesController } from "./stories.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // covers video; images stay well under
});

const storyMedia = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

const router = Router();

router.get("/shops/:id/stories", optionalAuth, storiesController.listForShop);
router.get("/shops/me/stories", requireAuth, storiesController.listMine);
router.post(
  "/shops/me/stories",
  requireAuth,
  storyMedia,
  storiesController.create,
);
router.delete(
  "/shops/me/stories/:id",
  requireAuth,
  storiesController.deleteMine,
);

router.get("/stories/:id", optionalAuth, storiesController.getById);
router.post("/stories/:id/view", optionalAuth, storiesController.recordView);

export default router;
