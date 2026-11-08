import type { TransactionType } from '../../shared/constants/index.js';
import { addPaise, subtractPaise } from '../../shared/utils/money.js';

/** Account balance delta for a single-account transaction (positive = credit). */
export function accountDeltaForType(type: TransactionType, amountPaise: number): number {
  switch (type) {
    case 'INCOME':
    case 'BORROWING':
    case 'LENDING_REPAYMENT':
    case 'REFUND':
      return amountPaise;
    case 'EXPENSE':
    case 'LENDING':
    case 'BORROWING_REPAYMENT':
      return -amountPaise;
    case 'TRANSFER':
      return -amountPaise;
    default:
      return 0;
  }
}

export function isExpenseLike(type: TransactionType): boolean {
  return type === 'EXPENSE';
}

export function isIncomeLike(type: TransactionType): boolean {
  return type === 'INCOME';
}

export function affectsBudget(type: TransactionType): 'consume' | 'reduce' | 'none' {
  if (type === 'EXPENSE') return 'consume';
  if (type === 'REFUND') return 'reduce';
  return 'none';
}

export function canRefundAmount(
  originalAmountPaise: number,
  refundedPaise: number,
  refundAmountPaise: number,
): boolean {
  return (
    refundAmountPaise > 0 &&
    refundAmountPaise <= Math.max(0, subtractPaise(originalAmountPaise, refundedPaise))
  );
}

export function reverseBudgetDelta(type: TransactionType, amountPaise: number): number {
  const effect = affectsBudget(type);
  if (effect === 'consume') return -amountPaise;
  if (effect === 'reduce') return amountPaise;
  return 0;
}

export function forwardBudgetDelta(type: TransactionType, amountPaise: number): number {
  const effect = affectsBudget(type);
  if (effect === 'consume') return amountPaise;
  if (effect === 'reduce') return -amountPaise;
  return 0;
}

export function computeBalanceFromMovements(
  openingBalancePaise: number,
  movements: Array<{ transactionType: TransactionType; amountPaise: number; accountId: string; toAccountId?: string | null; savingsMovementDirection?: 'DEPOSIT' | 'WITHDRAWAL' | null }>,
  accountId: string,
): number {
  let balance = openingBalancePaise;
  for (const m of movements) {
    if (m.transactionType === 'TRANSFER') {
      if (String(m.accountId) === accountId) {
        balance = m.savingsMovementDirection === 'WITHDRAWAL'
          ? addPaise(balance, m.amountPaise)
          : subtractPaise(balance, m.amountPaise);
      }
      if (m.toAccountId && String(m.toAccountId) === accountId) {
        balance = addPaise(balance, m.amountPaise);
      }
      continue;
    }
    if (String(m.accountId) !== accountId) continue;
    balance = addPaise(balance, accountDeltaForType(m.transactionType, m.amountPaise));
  }
  return balance;
}
