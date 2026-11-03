import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

export function validate(schema: ZodType, part: RequestPart = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(result.error);
    }
    if (part === 'query') {
      res.locals.validatedQuery = result.data;
    } else {
      (req as Request & Record<string, unknown>)[part] = result.data;
    }
    return next();
  };
}
