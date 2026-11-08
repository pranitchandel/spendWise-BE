import type mongoose from 'mongoose';
import { toRupees } from '../../shared/utils/money.js';
import { AccountModel } from '../accounts/account.model.js';
import { BorrowingRecordModel } from '../borrowing/borrowing.model.js';
import { LendingRecordModel } from '../lending/lending.model.js';
import { PlannedExpenseModel } from '../planned-expenses/planned-expense.model.js';
import { PlannedIncomeModel } from '../planned-incomes/planned-income.model.js';
import { SavingsGoalModel } from '../savings/savings.model.js';
import { computeBalanceFromMovements } from '../transactions/ledger.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import type { TransactionSnapshot } from './activity-log.service.js';

type Effect = { accountId: string; deltaPaise: number };

async function accountBalancePaise(userId: string, accountId: string, session: mongoose.ClientSession) {
  const account = await AccountModel.findOne({ _id: accountId, userId }).session(session).lean();
  if (!account) return null;
  const movements = await TransactionModel.find({
    userId,
    isDeleted: false,
    $or: [{ accountId: account._id }, { toAccountId: account._id }],
  })
    .select('type amountPaise accountId toAccountId savingsMovementDirection')
    .session(session)
    .lean();
  const balancePaise = computeBalanceFromMovements(
    account.openingBalancePaise,
    movements.map((m) => ({
      transactionType: m.type,
      amountPaise: m.amountPaise,
      accountId: String(m.accountId),
      toAccountId: m.toAccountId ? String(m.toAccountId) : null,
      savingsMovementDirection: m.savingsMovementDirection,
    })),
    accountId,
  );
  return { name: account.name, balancePaise };
}

async function accountsState(
  userId: string,
  snapshot: TransactionSnapshot,
  effects: Effect[],
  session: mongoose.ClientSession,
) {
  const ids = new Set<string>([snapshot.accountId, ...(snapshot.toAccountId ? [snapshot.toAccountId] : [])]);
  for (const effect of effects) ids.add(effect.accountId);
  const states = [];
  for (const accountId of ids) {
    const current = await accountBalancePaise(userId, accountId, session);
    if (!current) continue;
    const delta = effects.find((effect) => effect.accountId === accountId)?.deltaPaise ?? 0;
    states.push({
      accountId,
      name: current.name,
      balanceBefore: toRupees(current.balancePaise - delta),
      balanceAfter: toRupees(current.balancePaise),
    });
  }
  return states;
}

async function loanState(userId: string, snapshot: TransactionSnapshot, session: mongoose.ClientSession) {
  const recordId = snapshot.linkedRecordId as string | null | undefined;
  if (!recordId) return null;
  if (snapshot.linkedRecordType === 'LENDING') {
    const record = await LendingRecordModel.findOne({ _id: recordId, userId }).session(session).lean();
    if (!record) return null;
    return {
      kind: 'LENDING', id: recordId, person: record.personName, status: record.status,
      original: toRupees(record.originalAmountPaise), outstanding: toRupees(record.outstandingPaise),
      repaid: toRupees(record.totalRepaidPaise), interest: toRupees(record.totalInterestReceivedPaise),
    };
  }
  if (snapshot.linkedRecordType === 'BORROWING') {
    const record = await BorrowingRecordModel.findOne({ _id: recordId, userId }).session(session).lean();
    if (!record) return null;
    return {
      kind: 'BORROWING', id: recordId, person: record.lenderName, status: record.status,
      original: toRupees(record.originalAmountPaise), outstanding: toRupees(record.outstandingPaise),
      repaid: toRupees(record.totalRepaidPaise), interest: toRupees(record.totalInterestPaidPaise),
    };
  }
  return null;
}

async function originalExpenseState(userId: string, snapshot: TransactionSnapshot, session: mongoose.ClientSession) {
  if (snapshot.type !== 'REFUND' || !snapshot.linkedTransactionId) return null;
  const original = await TransactionModel.findOne({ _id: snapshot.linkedTransactionId, userId }).session(session).lean();
  if (!original) return null;
  return {
    id: String(original._id),
    amount: toRupees(original.amountPaise),
    refunded: toRupees(original.refundedPaise),
    remainingRefundable: toRupees(original.amountPaise - original.refundedPaise),
    plannedExpenseId: original.plannedExpenseId ? String(original.plannedExpenseId) : null,
  };
}

async function campaignState(userId: string, campaignId: string, session: mongoose.ClientSession) {
  const campaign = await PlannedExpenseModel.findOne({ _id: campaignId, userId }).session(session).lean();
  if (!campaign) return null;
  const estimatedPaise = campaign.items
    .filter((item) => !item.isDeleted)
    .reduce((total, item) => total + item.estimatedAmountPaise, 0);
  const linked = await TransactionModel.find({ userId, plannedExpenseId: campaignId, type: 'EXPENSE', isDeleted: false })
    .select('amountPaise refundedPaise')
    .session(session)
    .lean();
  const spentPaise = linked.reduce((total, tx) => total + tx.amountPaise - tx.refundedPaise, 0);
  return {
    id: campaignId, name: campaign.name, status: campaign.status,
    estimated: toRupees(estimatedPaise), spent: toRupees(spentPaise),
    remaining: toRupees(estimatedPaise - spentPaise), transactionCount: linked.length,
  };
}

async function plannedIncomeState(userId: string, planId: string, session: mongoose.ClientSession) {
  const plan = await PlannedIncomeModel.findOne({ _id: planId, userId }).session(session).lean();
  if (!plan) return null;
  const actuals = await TransactionModel.find({ userId, plannedIncomeId: planId, type: 'INCOME', isDeleted: false })
    .select('amountPaise')
    .session(session)
    .lean();
  return {
    id: planId, name: plan.name, status: plan.status, plannedAmount: toRupees(plan.amountPaise),
    recordedCount: actuals.length, recordedTotal: toRupees(actuals.reduce((total, tx) => total + tx.amountPaise, 0)),
  };
}

async function savingsGoalState(userId: string, goalId: string, session: mongoose.ClientSession) {
  const goal = await SavingsGoalModel.findOne({ _id: goalId, userId }).session(session).lean();
  if (!goal) return null;
  const movements = await TransactionModel.find({ userId, savingsGoalId: goalId, isDeleted: false })
    .select('amountPaise savingsMovementDirection')
    .session(session)
    .lean();
  const savedPaise = movements.reduce(
    (total, tx) => total + (tx.savingsMovementDirection === 'WITHDRAWAL' ? -tx.amountPaise : tx.amountPaise), 0,
  );
  return {
    id: goalId, name: goal.name, status: goal.status,
    target: toRupees(goal.targetAmountPaise), saved: toRupees(savedPaise),
    remaining: toRupees(goal.targetAmountPaise - savedPaise),
  };
}

// State of everything the transaction touches, read after the change inside the same session.
export async function captureRelatedState(
  userId: string,
  snapshot: TransactionSnapshot,
  effects: Effect[],
  session: mongoose.ClientSession,
) {
  const originalExpense = await originalExpenseState(userId, snapshot, session);
  const campaignId = snapshot.plannedExpenseId ?? originalExpense?.plannedExpenseId ?? null;
  const plannedIncomeId = snapshot.plannedIncomeId;
  const savingsGoalId = snapshot.savingsGoalId;
  return {
    accounts: await accountsState(userId, snapshot, effects, session),
    loan: await loanState(userId, snapshot, session),
    originalExpense,
    campaign: campaignId ? await campaignState(userId, campaignId, session) : null,
    plannedIncome: plannedIncomeId ? await plannedIncomeState(userId, plannedIncomeId, session) : null,
    savingsGoal: savingsGoalId ? await savingsGoalState(userId, savingsGoalId, session) : null,
  };
}
