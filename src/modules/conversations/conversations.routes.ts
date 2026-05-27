import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { conversationsController } from "./conversations.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);

router.post("/", conversationsController.start);
router.get("/", conversationsController.listMine);
router.get("/:id", conversationsController.getById);
router.get("/:id/messages", conversationsController.listMessages);
router.post("/:id/messages", conversationsController.sendText);
router.post("/:id/image", upload.single("image"), conversationsController.sendImage);
router.post("/:id/offer", conversationsController.sendOffer);
router.patch("/:id/offer/:messageId", conversationsController.resolveOffer);

export default router;
