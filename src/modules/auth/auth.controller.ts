import type { Request, Response } from "express";
import { authService } from "./auth.service.js";
import { loginSchema, signupSchema } from "./auth.schemas.js";
import { UnauthorizedError } from "../../errors.js";

export const authController = {
  async signup(req: Request, res: Response) {
    const input = signupSchema.parse(req.body);
    const { user, token } = await authService.signup(input);
    res.cookie("session", token, authService.cookieOptions());
    res.status(201).json({ user });
  },

  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const { user, token } = await authService.login(input);
    res.cookie("session", token, authService.cookieOptions());
    res.status(200).json({ user });
  },

  async logout(_req: Request, res: Response) {
    res.clearCookie("session", { ...authService.cookieOptions(), maxAge: 0 });
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const user = await authService.me(req.user.id);
    res.status(200).json({ user });
  },
};
