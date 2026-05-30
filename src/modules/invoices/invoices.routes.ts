import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { invoicesController } from "./invoices.controller.js";

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);

// Flat canonical routes
router.post("/invoices/:invoiceId/cancel", invoicesController.cancel);
router.post("/invoices/:invoiceId/pay", invoicesController.pay);
router.post("/invoice-lines/:lineId/confirm", invoicesController.confirmLine);
router.post("/invoice-lines/:lineId/extend", invoicesController.extendLine);
router.post(
  "/invoice-lines/:lineId/dispute",
  evidenceUpload.single("evidence_file"),
  invoicesController.disputeLine,
);

// Nested aliases — same handlers, conversation-scoped URLs the frontend prefers
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/cancel",
  invoicesController.cancel,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/pay",
  invoicesController.pay,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/release",
  invoicesController.confirmLine,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/extend",
  invoicesController.extendLine,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/dispute",
  evidenceUpload.single("evidence_file"),
  invoicesController.disputeLine,
);

export default router;
