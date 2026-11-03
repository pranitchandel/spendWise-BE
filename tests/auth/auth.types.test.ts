import { describe, expect, it } from 'vitest';
import { refreshSchema } from '../../src/modules/auth/auth.types.js';

describe('refresh request schema', () => {
  it('accepts an omitted body for cookie-based refresh and logout', () => {
    expect(refreshSchema.safeParse(undefined)).toEqual({ success: true, data: {} });
  });

  it('still accepts an optional refresh token in the request body', () => {
    expect(refreshSchema.parse({ refreshToken: 'refresh-token' })).toEqual({
      refreshToken: 'refresh-token',
    });
  });
});