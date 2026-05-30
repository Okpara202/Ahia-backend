import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { conversationsController } from "./conversations.controller.js";
import { invoicesController } from "../invoices/invoices.controller.js";

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);

router.post("/", conversationsController.start);
router.get("/", conversationsController.listMine);
router.get("/:id", conversationsController.getById);

router.get("/:id/messages/search", conversationsController.searchMessages);

router.post("/:id/messages", conversationsController.sendText);
router.post(
  "/:id/messages/image",
  imageUpload.single("image_file"),
  conversationsController.sendImage,
);
router.post(
  "/:id/messages/voice",
  voiceUpload.single("audio_file"),
  conversationsController.sendVoice,
);
router.patch("/:id/messages/:messageId", conversationsController.editText);
router.post(
  "/:id/messages/:messageId/reactions",
  conversationsController.reaction,
);

router.post("/:id/read", conversationsController.markRead);

// Invoices nested under a conversation (creation) — two URLs for the same handler
router.post("/:id/invoices", invoicesController.create);
router.post("/:id/messages/invoice", invoicesController.create);

// Backward-compatible image route (frontend may still send to /:id/image during transition)
router.post(
  "/:id/image",
  imageUpload.single("image_file"),
  conversationsController.sendImage,
);

export default router;
