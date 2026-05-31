import { Router } from "express";
import multer from "multer";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { discoverController } from "./discover.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const postMedia = upload.fields([
  { name: "video", maxCount: 1 },
  { name: "poster", maxCount: 1 },
]);

const router = Router();

router.get("/", optionalAuth, discoverController.getFeed);
router.post("/posts/:id/impression", optionalAuth, discoverController.impression);
router.post("/posts/:id/click", optionalAuth, discoverController.click);

router.post("/posts/:id/save", requireAuth, discoverController.save);
router.post("/posts", requireAuth, postMedia, discoverController.createPost);

router.post("/campaigns", requireAuth, discoverController.initCampaign);
router.get("/campaigns/me", requireAuth, discoverController.listMyCampaigns);
router.get(
  "/campaigns/:id/analytics",
  requireAuth,
  discoverController.campaignAnalytics,
);

export default router;
