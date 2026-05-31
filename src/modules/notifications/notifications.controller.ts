import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { notificationsService } from "./notifications.service.js";
import {
  listNotificationsQuery,
  notificationIdParam,
} from "./notifications.schemas.js";

export const notificationsController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listNotificationsQuery.parse(req.query);
    const result = await notificationsService.list(req.user.id, query);
    res.status(200).json(result);
  },

  async markRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = notificationIdParam.parse(req.params);
    await notificationsService.markRead(req.user.id, id);
    res.status(204).end();
  },

  async markAllRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    await notificationsService.markAllRead(req.user.id);
    res.status(204).end();
  },

  async archive(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = notificationIdParam.parse(req.params);
    await notificationsService.archive(req.user.id, id);
    res.status(204).end();
  },
};
