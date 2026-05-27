import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { wishlistController } from "./wishlist.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", wishlistController.list);
router.post("/", wishlistController.add);
router.delete("/:productId", wishlistController.remove);

export default router;
