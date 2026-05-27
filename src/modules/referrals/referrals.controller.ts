import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../errors.js";
import { referralsService } from "./referrals.service.js";
import { claimSchema, codeParam } from "./referrals.schemas.js";

export const referralsController = {
  async getMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const data = await referralsService.getMine(req.user.id);
    res.status(200).json(data);
  },

  async claim(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { code } = claimSchema.parse(req.body);
    const referral = await referralsService.claim(req.user.id, code);
    res.status(200).json({ referral });
  },

  async redirect(req: Request, res: Response) {
    const { code } = codeParam.parse(req.params);
    const safeCode = encodeURIComponent(code.toLowerCase());
    res.redirect(302, `${env.CLIENT_URL[0]}/signup?ref=${safeCode}`);
  },
};
