import { Router } from "express";
import { searchController } from "./search.controller.js";
import { locationsController } from "./locations.controller.js";

const router = Router();

router.get("/search", searchController.search);
router.get("/locations", locationsController.list);

export default router;
