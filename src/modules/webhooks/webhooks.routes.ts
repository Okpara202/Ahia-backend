import express, { Router } from "express";
import { paystackWebhookController } from "./paystack.controller.js";

const router = Router();

router.post(
  "/paystack",
  express.raw({ type: "*/*", limit: "1mb" }),
  paystackWebhookController.handle,
);

export default router;
