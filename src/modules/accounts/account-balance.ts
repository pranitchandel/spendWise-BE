import type { Types } from 'mongoose';
import { TransactionModel } from '../transactions/transaction.model.js';
import { AccountModel } from './account.model.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { addPaise, subtractPaise } from '../../shared/utils/money.js';

/**
 * Signed movement for an account from a transaction perspective.
 * Positive = money into account, Negative = money out of account.
 */
export function movementForAccount(
  type: string,
  amountPaise: number,
  accountId: string,
  txAccountId: string,
  toAccountId?: string | null,
  isCreditCardBillPayment = false,
): number {
  const acc = accountId.toString();
  const from = txAccountId.toString();
  const to = toAccountId?.toString() ?? null;

  switch (type) {
    case 'INCOME':
    case 'BORROWING':
    case 'LENDING_REPAYMENT':
    case 'REFUND':
      return from === acc ? amountPaise : 0;
    case 'EXPENSE':
    case 'LENDING':
    case 'BORROWING_REPAYMENT':
      // Credit card bill payment: transfer-like movement from bank to reduce CC liability
      if (isCreditCardBillPayment) {
        return from === acc ? -amountPaise : 0;
      }
      return from === acc ? -amountPaise : 0;
    case 'TRANSFER':
      if (from === acc) return -amountPaise;
      if (to === acc) return amountPaise;
      return 0;
    default:
      return 0;
  }
}

export async function calculateAccountBalance(
  userId: string | Types.ObjectId,
  accountId: string | Types.ObjectId,
): Promise<number> {
  const account = await AccountModel.findOne({ _id: accountId, userId, isArchived: false });
  if (!account) throw new NotFoundError('Account');

  const txs = await TransactionModel.find({
    userId,
    isDeleted: false,
    $or: [{ accountId }, { toAccountId: accountId }],
  }).select('type amountPaise accountId toAccountId isCreditCardBillPayment');

  let balance = account.openingBalancePaise;
  for (const tx of txs) {
    const delta = movementForAccount(
      tx.type,
      tx.amountPaise,
      accountId.toString(),
      tx.accountId.toString(),
      tx.toAccountId?.toString(),
      tx.isCreditCardBillPayment,
    );
    balance = addPaise(balance, delta);
  }
  return balance;
}

export async function calculateAllAccountBalances(userId: string | Types.ObjectId) {
  const accounts = await AccountModel.find({ userId, isArchived: false, isActive: true });
  const results = [];
  let total = 0;
  for (const account of accounts) {
    const balancePaise = await calculateAccountBalance(userId, account._id);
    // Credit cards: balance represents amount owed (typically negative available)
    total = account.type === 'CREDIT_CARD' ? subtractPaise(total, Math.max(0, -balancePaise) === 0 ? Math.abs(Math.min(balancePaise, 0)) : 0) : addPaise(total, balancePaise);
    // Simpler: available cash = sum of non-credit-card balances; CC tracked separately
    results.push({
      accountId: account._id.toString(),
      name: account.name,
      type: account.type,
      balancePaise,
    });
  }

  const availablePaise = results
    .filter((a) => a.type !== 'CREDIT_CARD')
    .reduce((sum, a) => addPaise(sum, a.balancePaise), 0);

  const creditCardDebtPaise = results
    .filter((a) => a.type === 'CREDIT_CARD')
    .reduce((sum, a) => {
      // For CC, expenses increase amount owed (we store as negative balance or track owed)
      // Convention: opening 0, expense makes balance more negative (movement -amount)
      const owed = a.balancePaise < 0 ? Math.abs(a.balancePaise) : 0;
      return addPaise(sum, owed);
    }, 0);

  return { accounts: results, availablePaise, creditCardDebtPaise };
}
