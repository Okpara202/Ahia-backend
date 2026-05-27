import type { Request, Response } from "express";
import { productsService } from "./products.service.js";
import {
  createProductSchema,
  listProductsQuery,
  productIdParam,
  updateProductSchema,
  visibilitySchema,
} from "./products.schemas.js";
import { UnauthorizedError } from "../../errors.js";

function extractFiles(req: Request): Express.Multer.File[] {
  return (req.files as Express.Multer.File[] | undefined) ?? [];
}

export const productsController = {
  async list(req: Request, res: Response) {
    const query = listProductsQuery.parse(req.query);
    const result = await productsService.list(query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    const { id } = productIdParam.parse(req.params);
    const product = await productsService.getById(id);
    res.status(200).json({ product });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createProductSchema.parse(req.body);
    const product = await productsService.create(req.user.id, input, extractFiles(req));
    res.status(201).json({ product });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = productIdParam.parse(req.params);
    const input = updateProductSchema.parse(req.body);
    const product = await productsService.update(
      req.user.id,
      id,
      input,
      extractFiles(req),
    );
    res.status(200).json({ product });
  },

  async softDelete(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = productIdParam.parse(req.params);
    await productsService.softDelete(req.user.id, id);
    res.status(204).end();
  },

  async setVisibility(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = productIdParam.parse(req.params);
    const { hidden } = visibilitySchema.parse(req.body);
    const product = await productsService.setVisibility(req.user.id, id, hidden);
    res.status(200).json({ product });
  },
};
