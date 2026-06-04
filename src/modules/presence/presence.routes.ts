import { Router } from "express";
import { optionalAuth } from "../../middleware/auth.js";
import { presenceController } from "./presence.controller.js";

const router = Router();

router.get("/users/:id/presence", optionalAuth, presenceController.get);

export default router;
