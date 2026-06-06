import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { adminAuthController } from "./auth/admin.controller.js";

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

export default router;
