import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { invoicesController } from "./invoices.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/invoices/:invoiceId/cancel", invoicesController.cancel);
router.post("/invoices/:invoiceId/pay", invoicesController.pay);
router.post("/invoice-lines/:lineId/confirm", invoicesController.confirmLine);
router.post("/invoice-lines/:lineId/dispute", invoicesController.disputeLine);

export default router;
