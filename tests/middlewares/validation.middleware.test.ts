import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middlewares/validation.middleware.js';

describe('query validation middleware', () => {
  it('stores parsed query values without assigning to Express request query', () => {
    const query = { page: '2' };
    const request = { get query() { return query; } } as Request;
    const response = { locals: {} } as Response;
    const next = vi.fn() as unknown as NextFunction;

    expect(() => validate(z.object({ page: z.coerce.number().default(1) }), 'query')(request, response, next)).not.toThrow();
    expect(response.locals.validatedQuery).toEqual({ page: 2 });
    expect(request.query).toBe(query);
    expect(next).toHaveBeenCalledOnce();
  });
});