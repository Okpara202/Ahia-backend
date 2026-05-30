import { Router } from "express";
import multer from "multer";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { shopsController } from "./shops.controller.js";
import { followsController } from "../follows/follows.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Accept both the legacy names (avatar/banner) and the new ones (avatar_file/banner_file).
const shopMediaFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "banner", maxCount: 1 },
  { name: "avatar_file", maxCount: 1 },
  { name: "banner_file", maxCount: 1 },
]);

const router = Router();

router.post("/", requireAuth, shopMediaFields, shopsController.createMine);
router.get("/me", requireAuth, shopsController.getMine);
router.patch("/me", requireAuth, shopMediaFields, shopsController.updateMine);
router.delete("/me", requireAuth, shopsController.demolishMine);

// Dedicated avatar / banner upload + remove
router.patch(
  "/me/avatar",
  requireAuth,
  upload.single("avatar_file"),
  shopsController.uploadAvatar,
);
router.delete("/me/avatar", requireAuth, shopsController.removeAvatar);
router.patch(
  "/me/banner",
  requireAuth,
  upload.single("banner_file"),
  shopsController.uploadBanner,
);
router.delete("/me/banner", requireAuth, shopsController.removeBanner);

router.get("/:id", optionalAuth, shopsController.getById);
router.get("/:id/products", shopsController.listProducts);

router.post("/:id/follow", requireAuth, followsController.follow);
router.delete("/:id/follow", requireAuth, followsController.unfollow);

export default router;
