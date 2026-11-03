import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { categoryController } from './category.controller.js';
import {
  categoryIdParamsSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './category.types.js';

export const categoryRoutes = Router();

categoryRoutes.use(authMiddleware);
categoryRoutes.get('/', validate(listCategoriesQuerySchema, 'query'), categoryController.list);
categoryRoutes.post('/', validate(createCategorySchema), categoryController.create);
categoryRoutes.put(
  '/:id',
  validate(categoryIdParamsSchema, 'params'),
  validate(updateCategorySchema),
  categoryController.update,
);
categoryRoutes.delete(
  '/:id/permanent',
  validate(categoryIdParamsSchema, 'params'),
  categoryController.permanentlyDelete,
);
categoryRoutes.delete(
  '/:id',
  validate(categoryIdParamsSchema, 'params'),
  categoryController.remove,
);
