import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { adminAuthController } from "./auth/admin.controller.js";
import { adminDisputesController } from "./disputes/admin.disputes.controller.js";
import { adminUsersController } from "./users/admin.users.controller.js";
import { adminShopsController } from "./shops/admin.shops.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const disputeMessageMedia = upload.fields([
  { name: "image_file", maxCount: 1 },
]);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email as string | undefined)?.toLowerCase().trim() ?? "anon";
    return `${req.ip}:${email}`;
  },
  message: {
    error: {
      code: "too_many_attempts",
      message: "Too many login attempts. Try again in 15 minutes.",
    },
  },
});

const router = Router();

// ---- Public / pre-session auth routes ----
router.post("/auth/login", loginLimiter, adminAuthController.login);
router.get("/auth/2fa/setup", adminAuthController.twoFactorSetupStart);
router.post("/auth/2fa/setup", adminAuthController.twoFactorSetupVerify);
router.post("/auth/2fa/verify", adminAuthController.twoFactorVerify);
router.post("/auth/logout", adminAuthController.logout);

// ---- Authed routes (cookie + active session + 2FA enabled) ----
router.get("/auth/me", requireAdmin(), adminAuthController.me);
router.post(
  "/auth/change-password",
  requireAdmin(),
  adminAuthController.changePassword,
);

// ---- Disputes ----
router.get("/disputes", requireAdmin(), adminDisputesController.list);
router.get("/disputes/:id", requireAdmin(), adminDisputesController.getById);
router.post(
  "/disputes/:id/messages",
  requireAdmin(),
  disputeMessageMedia,
  adminDisputesController.postMessage,
);
router.post(
  "/disputes/:id/resolve",
  requireAdmin(),
  adminDisputesController.resolve,
);

// ---- Users ----
router.get("/users", requireAdmin(), adminUsersController.list);
router.get("/users/:id", requireAdmin(), adminUsersController.getById);
router.post("/users/:id/suspend", requireAdmin(), adminUsersController.suspend);
router.post("/users/:id/restore", requireAdmin(), adminUsersController.restore);

// ---- Shops ----
router.get("/shops", requireAdmin(), adminShopsController.list);
router.get("/shops/:id", requireAdmin(), adminShopsController.getById);
router.post(
  "/shops/:id/deactivate",
  requireAdmin(),
  adminShopsController.deactivate,
);
router.post("/shops/:id/restore", requireAdmin(), adminShopsController.restore);

export default router;
