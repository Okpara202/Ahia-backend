import { Router } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { reviewsController } from "./reviews.controller.js";

const router = Router();

router.get("/products/:id/reviews", optionalAuth, reviewsController.listForProduct);
router.get("/shops/:id/rating", optionalAuth, reviewsController.shopRating);
router.post("/reviews", requireAuth, reviewsController.create);

export default router;
