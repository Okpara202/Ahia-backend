import { Router } from "express";
import { optionalAuth } from "../../middleware/auth.js";
import { searchController } from "./search.controller.js";
import { locationsController } from "./locations.controller.js";

const router = Router();

router.get("/search", optionalAuth, searchController.search);
router.get("/locations", optionalAuth, locationsController.list);

export default router;
