import { describe, expect, it } from 'vitest';
import { listTransactionsSchema } from '../../src/modules/transactions/transaction.types.js';

describe('listTransactionsSchema', () => {
  it('treats blank optional filters as omitted', () => {
    const result = listTransactionsSchema.safeParse({
      page: '1',
      limit: '100',
      search: '',
      type: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ page: 1, limit: 100 });
      expect(result.data.search).toBeUndefined();
      expect(result.data.type).toBeUndefined();
    }
  });
});