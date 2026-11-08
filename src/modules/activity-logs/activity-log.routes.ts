import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validation.middleware.js';
import { sendSuccess } from '../../shared/utils/api-response.js';
import { listActivityLogs } from './activity-log.service.js';
import { listActivityLogsSchema, type ListActivityLogsQuery } from './activity-log.types.js';

export const activityLogRouter = Router();

activityLogRouter.use(authMiddleware);

activityLogRouter.get('/', validate(listActivityLogsSchema, 'query'), async (req, res, next) => {
  try {
    const result = await listActivityLogs(
      req.user!.userId,
      res.locals.validatedQuery as ListActivityLogsQuery,
    );
    return sendSuccess(res, result.items, 200, { pagination: result.pagination });
  } catch (error) {
    return next(error);
  }
});
