import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { transactionsController } from "./transactions.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", transactionsController.listMine);
router.get("/me", transactionsController.listMine);
router.get("/sales", transactionsController.listSales);
router.get("/by-reference/:reference", transactionsController.getByReference);
router.get("/:id", transactionsController.getById);

export default router;
