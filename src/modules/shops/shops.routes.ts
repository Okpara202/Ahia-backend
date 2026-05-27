import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { shopsController } from "./shops.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const shopMediaFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "banner", maxCount: 1 },
]);

const router = Router();

router.post("/me", requireAuth, shopMediaFields, shopsController.createMine);
router.get("/me", requireAuth, shopsController.getMine);
router.patch("/me", requireAuth, shopMediaFields, shopsController.updateMine);

router.get("/:id", shopsController.getById);
router.get("/:id/products", shopsController.listProducts);

export default router;
