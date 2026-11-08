import type mongoose from 'mongoose';
import { endOfDayIST, startOfDayIST } from '../../shared/utils/date.js';
import { toRupees } from '../../shared/utils/money.js';
import { accountDeltaForType } from '../transactions/ledger.js';
import type { TransactionType } from '../../shared/constants/index.js';
import {
  ActivityLogModel,
  type ActivityAction,
  type ActivitySource,
} from './activity-log.model.js';
import { captureRelatedState } from './activity-log.context.js';
import type { ListActivityLogsQuery } from './activity-log.types.js';

export type TransactionSnapshot = {
  id: string;
  amountPaise: number;
  type: string;
  accountId: string;
  toAccountId: string | null;
  savingsMovementDirection: 'DEPOSIT' | 'WITHDRAWAL' | null;
  savingsGoalId: string | null;
  plannedExpenseId: string | null;
  plannedIncomeId: string | null;
  linkedRecordType: string | null;
  linkedTransactionId: string | null;
} & Record<string, unknown>;

type Effect = { accountId: string; deltaPaise: number };

const IGNORED_DIFF_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'amountPaise']);

export function deriveSource(tx: TransactionSnapshot): ActivitySource {
  if (tx.savingsGoalId) return 'SAVINGS';
  if (tx.plannedExpenseId) return 'PLANNED_EXPENSE';
  if (tx.plannedIncomeId) return 'PLANNED_INCOME';
  if (tx.type === 'LENDING') return 'LENDING';
  if (tx.type === 'BORROWING') return 'BORROWING';
  if (tx.type === 'LENDING_REPAYMENT' || tx.type === 'BORROWING_REPAYMENT') return 'REPAYMENT';
  if (tx.type === 'REFUND') return 'REFUND';
  return 'MANUAL';
}

// Mirrors computeBalanceFromMovements so logged effects reconcile with account balances.
export function balanceEffects(tx: TransactionSnapshot): Effect[] {
  if (tx.type === 'TRANSFER') {
    if (tx.savingsMovementDirection === 'WITHDRAWAL') {
      return [{ accountId: tx.accountId, deltaPaise: tx.amountPaise }];
    }
    const effects: Effect[] = [{ accountId: tx.accountId, deltaPaise: -tx.amountPaise }];
    if (tx.toAccountId) effects.push({ accountId: tx.toAccountId, deltaPaise: tx.amountPaise });
    return effects;
  }
  const delta = accountDeltaForType(tx.type as TransactionType, tx.amountPaise);
  return delta === 0 ? [] : [{ accountId: tx.accountId, deltaPaise: delta }];
}

function mergeEffects(effects: Effect[]): Effect[] {
  const totals = new Map<string, number>();
  for (const effect of effects) {
    totals.set(effect.accountId, (totals.get(effect.accountId) ?? 0) + effect.deltaPaise);
  }
  return [...totals.entries()]
    .filter(([, deltaPaise]) => deltaPaise !== 0)
    .map(([accountId, deltaPaise]) => ({ accountId, deltaPaise }));
}

function diffSnapshots(before: TransactionSnapshot, after: TransactionSnapshot) {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORED_DIFF_FIELDS.has(field)) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
  }
  return changes;
}

export async function recordTransactionActivity(
  userId: string,
  entry:
    | { action: 'CREATED'; after: TransactionSnapshot }
    | { action: 'UPDATED'; before: TransactionSnapshot; after: TransactionSnapshot }
    | { action: 'DELETED'; before: TransactionSnapshot },
  session: mongoose.ClientSession,
) {
  const subject = entry.action === 'DELETED' ? entry.before : entry.after;
  let effects: Effect[];
  let changes: ReturnType<typeof diffSnapshots> = [];

  if (entry.action === 'CREATED') {
    effects = balanceEffects(entry.after);
  } else if (entry.action === 'UPDATED') {
    effects = mergeEffects([
      ...balanceEffects(entry.before).map((e) => ({ ...e, deltaPaise: -e.deltaPaise })),
      ...balanceEffects(entry.after),
    ]);
    changes = diffSnapshots(entry.before, entry.after);
  } else {
    effects = balanceEffects(entry.before).map((e) => ({ ...e, deltaPaise: -e.deltaPaise }));
  }

  await ActivityLogModel.create(
    [
      {
        userId,
        transactionId: subject.id,
        action: entry.action,
        transactionType: subject.type as TransactionType,
        source: deriveSource(subject),
        amountPaise: subject.amountPaise,
        effects,
        changes,
        snapshot: subject,
        context: await captureRelatedState(userId, subject, effects, session),
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

export async function listActivityLogs(userId: string, query: ListActivityLogsQuery) {
  const filter: Record<string, unknown> = { userId };
  if (query.action) filter.action = query.action;
  if (query.transactionType) filter.transactionType = query.transactionType;
  if (query.source) filter.source = query.source;
  if (query.transactionId) filter.transactionId = query.transactionId;
  if (query.accountId) filter['effects.accountId'] = query.accountId;
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfDayIST(query.from);
    if (query.to) range.$lte = endOfDayIST(query.to);
    filter.occurredAt = range;
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    ActivityLogModel.find(filter).sort({ occurredAt: -1, _id: -1 }).skip(skip).limit(query.limit).lean(),
    ActivityLogModel.countDocuments(filter),
  ]);

  return {
    items: items.map((log) => ({
      id: log._id.toString(),
      transactionId: log.transactionId.toString(),
      action: log.action as ActivityAction,
      transactionType: log.transactionType,
      source: log.source,
      amount: toRupees(log.amountPaise),
      effects: log.effects.map((effect) => ({
        accountId: effect.accountId.toString(),
        delta: toRupees(effect.deltaPaise),
      })),
      changes: log.changes.map((change) => ({ field: change.field, from: change.from, to: change.to })),
      snapshot: log.snapshot,
      context: log.context ?? null,
      occurredAt: log.occurredAt.toISOString(),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
