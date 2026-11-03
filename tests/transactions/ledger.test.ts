import { describe, expect, it } from 'vitest';
import {
  accountDeltaForType,
  affectsBudget,
  canRefundAmount,
  computeBalanceFromMovements,
  isExpenseLike,
  isIncomeLike,
} from '../../src/modules/transactions/ledger.js';

describe('financial ledger rules', () => {
  it('applies each transaction to the correct account balance', () => {
    const movements = [
      { transactionType: 'INCOME' as const, amountPaise: 20_000, accountId: 'cash' },
      { transactionType: 'EXPENSE' as const, amountPaise: 5_000, accountId: 'cash' },
      { transactionType: 'LENDING' as const, amountPaise: 3_000, accountId: 'cash' },
      { transactionType: 'BORROWING' as const, amountPaise: 4_000, accountId: 'cash' },
      { transactionType: 'LENDING_REPAYMENT' as const, amountPaise: 1_000, accountId: 'cash' },
      { transactionType: 'BORROWING_REPAYMENT' as const, amountPaise: 2_000, accountId: 'cash' },
      {
        transactionType: 'TRANSFER' as const,
        amountPaise: 2_500,
        accountId: 'cash',
        toAccountId: 'savings',
      },
      { transactionType: 'REFUND' as const, amountPaise: 500, accountId: 'cash' },
    ];

    expect(computeBalanceFromMovements(100_000, movements, 'cash')).toBe(113_000);
    expect(computeBalanceFromMovements(1_000, movements, 'savings')).toBe(3_500);
  });

  it('keeps lending, borrowing, repayments, and transfers out of income and expense totals', () => {
    expect(isIncomeLike('INCOME')).toBe(true);
    expect(isExpenseLike('EXPENSE')).toBe(true);
    expect(isIncomeLike('BORROWING')).toBe(false);
    expect(isExpenseLike('LENDING')).toBe(false);
    expect(isIncomeLike('LENDING_REPAYMENT')).toBe(false);
    expect(isExpenseLike('BORROWING_REPAYMENT')).toBe(false);
    expect(isIncomeLike('TRANSFER')).toBe(false);
    expect(isExpenseLike('TRANSFER')).toBe(false);
    expect(accountDeltaForType('LENDING_REPAYMENT', 1_000)).toBe(1_000);
    expect(accountDeltaForType('BORROWING_REPAYMENT', 1_000)).toBe(-1_000);
  });

  it('only expenses consume budgets and refunds reduce them', () => {
    expect(affectsBudget('EXPENSE')).toBe('consume');
    expect(affectsBudget('REFUND')).toBe('reduce');
    expect(affectsBudget('LENDING')).toBe('none');
    expect(affectsBudget('BORROWING')).toBe('none');
    expect(affectsBudget('TRANSFER')).toBe('none');
  });

  it('limits refunds to the unrefunded expense balance', () => {
    expect(canRefundAmount(10_000, 7_000, 3_000)).toBe(true);
    expect(canRefundAmount(10_000, 7_000, 3_001)).toBe(false);
    expect(canRefundAmount(10_000, 10_000, 1)).toBe(false);
    expect(canRefundAmount(10_000, 0, 0)).toBe(false);
  });
});