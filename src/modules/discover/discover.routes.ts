import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { idempotencyGuard } from "../../middleware/idempotency.js";
import { discoverController } from "./discover.controller.js";

// Per-IP throttle for fire-and-forget counter endpoints. 60/min is well
// above any honest video scroll rate; below this is impression spam.
const counterLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "too_many_requests",
      message: "Slow down — too many requests from this address.",
    },
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const postMedia = upload.fields([
  { name: "video", maxCount: 1 },
  { name: "poster", maxCount: 1 },
]);

const editMedia = upload.fields([{ name: "poster", maxCount: 1 }]);

const router = Router();

router.get("/", optionalAuth, discoverController.getFeed);
router.post(
  "/posts/:id/impression",
  counterLimiter,
  optionalAuth,
  discoverController.impression,
);
router.post(
  "/posts/:id/click",
  counterLimiter,
  optionalAuth,
  discoverController.click,
);

router.post(
  "/posts/:id/save",
  counterLimiter,
  requireAuth,
  discoverController.save,
);
// `/posts/me` must come BEFORE `/posts/:id` so Express doesn't match "me"
// as a UUID param.
router.get("/posts/me", requireAuth, discoverController.listMyPosts);
router.post("/posts", requireAuth, postMedia, discoverController.createPost);
router.get("/posts/:id/analytics", requireAuth, discoverController.postAnalytics);
router.get("/posts/:id", requireAuth, discoverController.getMyPostById);
router.patch(
  "/posts/:id",
  requireAuth,
  editMedia,
  discoverController.editPost,
);
router.delete("/posts/:id", requireAuth, discoverController.deletePost);

router.post(
  "/campaigns",
  requireAuth,
  idempotencyGuard,
  discoverController.initCampaign,
);
router.get("/campaigns/me", requireAuth, discoverController.listMyCampaigns);
router.get(
  "/campaigns/:id/analytics",
  requireAuth,
  discoverController.campaignAnalytics,
);

export default router;
