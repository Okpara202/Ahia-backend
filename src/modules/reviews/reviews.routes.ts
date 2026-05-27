import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { reviewsController } from "./reviews.controller.js";

const router = Router();

router.get("/products/:id/reviews", reviewsController.listForProduct);
router.get("/shops/:id/rating", reviewsController.shopRating);
router.post("/reviews", requireAuth, reviewsController.create);

export default router;
