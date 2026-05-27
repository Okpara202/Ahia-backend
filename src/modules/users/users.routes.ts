import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { usersController } from "./users.controller.js";

const router = Router();

router.use(requireAuth);

router.patch("/profile", usersController.updateProfile);
router.patch("/role", usersController.updateRole);

export default router;
