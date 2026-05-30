import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { usersController } from "./users.controller.js";

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);

router.patch("/profile", usersController.updateProfile);
router.patch("/role", usersController.updateRole);
router.patch(
  "/me/avatar",
  avatarUpload.single("avatar_file"),
  usersController.uploadAvatar,
);
router.delete("/me/avatar", usersController.removeAvatar);

export default router;
