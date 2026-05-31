import { Router } from "express";
import multer from "multer";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { productsController } from "./products.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
});

const productImages = upload.array("image_files", 10);

const router = Router();

router.get("/", optionalAuth, productsController.list);
router.get("/:id", optionalAuth, productsController.getById);

router.post("/", requireAuth, productImages, productsController.create);
router.patch("/:id", requireAuth, productImages, productsController.update);
router.delete("/:id", requireAuth, productsController.softDelete);
router.patch("/:id/visibility", requireAuth, productsController.setVisibility);

export default router;
