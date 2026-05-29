import { Router } from "express";
import multer from "multer";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { shopsController } from "./shops.controller.js";
import { followsController } from "../follows/follows.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const shopMediaFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "banner", maxCount: 1 },
]);

const router = Router();

router.post("/", requireAuth, shopMediaFields, shopsController.createMine);
router.get("/me", requireAuth, shopsController.getMine);
router.patch("/me", requireAuth, shopMediaFields, shopsController.updateMine);
router.delete("/me", requireAuth, shopsController.demolishMine);

router.get("/:id", optionalAuth, shopsController.getById);
router.get("/:id/products", shopsController.listProducts);

router.post("/:id/follow", requireAuth, followsController.follow);
router.delete("/:id/follow", requireAuth, followsController.unfollow);

export default router;
