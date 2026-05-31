import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { invoicesController } from "./invoices.controller.js";

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

// NOTE: this router is mounted at app root (no prefix), so router.use(requireAuth)
// would 401 every request including ones bound for other routers further down
// the chain (/feed, /discover, /search, /locations). Apply requireAuth per-route
// instead.

// Flat canonical routes
router.post("/invoices/:invoiceId/cancel", requireAuth, invoicesController.cancel);
router.post("/invoices/:invoiceId/pay", requireAuth, invoicesController.pay);
router.post("/invoice-lines/:lineId/confirm", requireAuth, invoicesController.confirmLine);
router.post("/invoice-lines/:lineId/extend", requireAuth, invoicesController.extendLine);
router.post(
  "/invoice-lines/:lineId/dispute",
  requireAuth,
  evidenceUpload.single("evidence_file"),
  invoicesController.disputeLine,
);

// Nested aliases — same handlers, conversation-scoped URLs the frontend prefers
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/cancel",
  requireAuth,
  invoicesController.cancel,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/pay",
  requireAuth,
  invoicesController.pay,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/release",
  requireAuth,
  invoicesController.confirmLine,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/extend",
  requireAuth,
  invoicesController.extendLine,
);
router.post(
  "/conversations/:conversationId/invoices/:invoiceId/lines/:lineId/dispute",
  requireAuth,
  evidenceUpload.single("evidence_file"),
  invoicesController.disputeLine,
);

export default router;
