import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';

describe('TransactionModel', () => {
  it('retains the fields written by transaction services', async () => {
    const transaction = new TransactionModel({
      userId: new Types.ObjectId(),
      amountPaise: 1250,
      transactionDate: new Date('2026-11-03T00:00:00.000Z'),
      transactionTime: '09:30',
      type: 'EXPENSE',
      interestPaise: 0,
      categoryId: new Types.ObjectId(),
      paymentMode: 'UPI',
      accountId: new Types.ObjectId(),
      transferGroupId: 'transfer-group',
      isCreditCardBillPayment: false,
      idempotencyKey: 'request-123',
    });

    await expect(transaction.validate()).resolves.toBeUndefined();
    expect(transaction.type).toBe('EXPENSE');
    expect(transaction.transactionTime).toBe('09:30');
    expect(transaction.idempotencyKey).toBe('request-123');
    expect(transaction.toObject()).not.toHaveProperty('transactionType');
  });

  it('uniquely indexes idempotency keys per user', () => {
    const idempotencyIndex = TransactionModel.schema
      .indexes()
      .find(([fields, options]) =>
        'idempotencyKey' in fields && options?.unique === true,
      );

    expect(idempotencyIndex?.[0]).toEqual({ userId: 1, idempotencyKey: 1 });
    expect(idempotencyIndex?.[1]?.partialFilterExpression).toEqual({
      idempotencyKey: { $type: 'string' },
    });
  });
});