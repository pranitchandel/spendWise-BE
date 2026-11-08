import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import type { PaymentMode } from '../../shared/constants/index.js';
import { formatDateIST, nowInIST, startOfDayIST, toIST } from '../../shared/utils/date.js';
import { addPaise, subtractPaise, toPaise, toRupees } from '../../shared/utils/money.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { buildPaginationMeta, normalizePagination } from '../../shared/utils/pagination.js';
import { AccountModel } from '../accounts/account.model.js';
import { accountService } from '../accounts/account.service.js';
import { CategoryModel } from '../categories/category.model.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import { createTransaction } from '../transactions/transaction.service.js';
import {
  SAVINGS_GOAL_STATUSES,
  SAVINGS_OPTION_TYPES,
  type SavingsGoalDocument,
  SavingsGoalModel,
} from './savings.model.js';

const COMPOUNDING_PERIODS = { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, YEARLY: 1 } as const;
type AllocationInput = {
  id?: string;
  name: string;
  optionType: typeof SAVINGS_OPTION_TYPES[number];
  expectedAnnualReturnRate: number;
  compoundingFrequency: keyof typeof COMPOUNDING_PERIODS;
  monthlyContribution: number;
};
type SavingsGoalInput = {
  name?: string;
  targetAmount?: number;
  targetDate?: string;
  notes?: string;
  status?: typeof SAVINGS_GOAL_STATUSES[number];
  allocations?: AllocationInput[];
};

function projectionFor(
  currentBalancePaise: number,
  monthlyContributionPaise: number,
  annualReturnRate: number,
  compoundingFrequency: keyof typeof COMPOUNDING_PERIODS,
  months: number,
) {
  const periodsPerYear = COMPOUNDING_PERIODS[compoundingFrequency];
  const annualRate = annualReturnRate / 100;
  const monthlyRate = Math.pow(1 + annualRate / periodsPerYear, periodsPerYear / 12) - 1;
  let projectedBalancePaise = currentBalancePaise;
  for (let month = 0; month < months; month += 1) {
    projectedBalancePaise = Math.round(projectedBalancePaise * (1 + monthlyRate));
    projectedBalancePaise = addPaise(projectedBalancePaise, monthlyContributionPaise);
  }
  return projectedBalancePaise;
}

function validateAllocations(allocations: AllocationInput[]) {
  if (!allocations.length) throw new ValidationError('Add at least one savings allocation');

  for (const allocation of allocations) {
    if (allocation.expectedAnnualReturnRate < 0 || allocation.expectedAnnualReturnRate > 100) {
      throw new ValidationError('Expected annual return must be between 0 and 100 percent');
    }
    if (allocation.monthlyContribution < 0) throw new ValidationError('Monthly contribution cannot be negative');
  }
}

async function serializeGoals(goals: SavingsGoalDocument[], userId: string) {
  if (!goals.length) return [];

  const serialized = await Promise.all(goals.map(async (goal) => {
    const now = nowInIST();
    const monthsUntilTarget = Math.min(1200, Math.max(0, Math.ceil(toIST(goal.targetDate).diff(now, 'month', true))));
    const projectionMonths = goal.status === 'COMPLETED' || goal.status === 'ARCHIVED' ? 0 : monthsUntilTarget;
    const activeAllocations = goal.allocations.filter((allocation) => !allocation.isDeleted);
    const allocations = await Promise.all(activeAllocations.map(async (allocation) => {
      const movements = await TransactionModel.find({
        userId: toObjectId(userId, 'userId'),
        savingsGoalId: goal._id,
        savingsAllocationId: allocation._id.toString(),
        isDeleted: false,
        type: 'TRANSFER',
      }).sort({ transactionDate: -1, createdAt: -1 });
      const balancePaise = movements.reduce((balance, movement) => (
        movement.savingsMovementDirection === 'DEPOSIT' || (
          !movement.savingsMovementDirection &&
          allocation.accountId && movement.toAccountId?.toString() === allocation.accountId.toString()
        )
          ? addPaise(balance, movement.amountPaise)
          : subtractPaise(balance, movement.amountPaise)
      ), 0);
      const monthlyContributionPaise = goal.status === 'ACTIVE' ? allocation.monthlyContributionPaise : 0;
      const projectedBalancePaise = projectionFor(
        balancePaise,
        monthlyContributionPaise,
        allocation.expectedAnnualReturnRate,
        allocation.compoundingFrequency,
        projectionMonths,
      );
      const projectedContributionsPaise = monthlyContributionPaise * monthsUntilTarget;

      return {
        id: allocation._id.toString(),
        name: allocation.name,
        optionType: allocation.optionType,
        currentBalance: toRupees(balancePaise),
        expectedAnnualReturnRate: allocation.expectedAnnualReturnRate,
        compoundingFrequency: allocation.compoundingFrequency,
        monthlyContribution: toRupees(monthlyContributionPaise),
        projectedBalance: toRupees(projectedBalancePaise),
        projectedContributions: toRupees(projectedContributionsPaise),
        projectedGrowth: toRupees(subtractPaise(projectedBalancePaise, addPaise(balancePaise, projectedContributionsPaise))),
        movements: movements.map((movement) => ({
          id: movement._id.toString(),
          amount: toRupees(movement.amountPaise),
          date: formatDateIST(movement.transactionDate),
          direction: movement.savingsMovementDirection ?? (
            allocation.accountId && movement.toAccountId?.toString() === allocation.accountId.toString()
              ? 'DEPOSIT' as const
              : 'WITHDRAWAL' as const
          ),
          note: movement.note,
          sourceAccountId: movement.savingsMovementDirection === 'WITHDRAWAL' ? '' : movement.accountId.toString(),
          destinationAccountId: movement.savingsMovementDirection === 'WITHDRAWAL'
            ? movement.accountId.toString()
            : movement.toAccountId?.toString() ?? null,
        })),
      };
    }));

    const currentBalance = allocations.reduce((total, allocation) => addPaise(total, toPaise(allocation.currentBalance)), 0);
    const projectedBalance = allocations.reduce((total, allocation) => addPaise(total, toPaise(allocation.projectedBalance)), 0);
    const monthlyContribution = allocations.reduce((total, allocation) => addPaise(total, toPaise(allocation.monthlyContribution)), 0);
    return {
      id: goal._id.toString(),
      name: goal.name,
      targetAmount: toRupees(goal.targetAmountPaise),
      targetDate: formatDateIST(goal.targetDate),
      notes: goal.notes,
      status: goal.status,
      monthsUntilTarget,
      currentBalance: toRupees(currentBalance),
      projectedBalance: toRupees(projectedBalance),
      projectedGrowth: toRupees(subtractPaise(projectedBalance, addPaise(currentBalance, allocations.reduce((total, allocation) => addPaise(total, toPaise(allocation.projectedContributions)), 0)))),
      monthlyContribution: toRupees(monthlyContribution),
      targetGap: toRupees(subtractPaise(goal.targetAmountPaise, currentBalance)),
      progressPercent: goal.targetAmountPaise > 0 ? Math.round((currentBalance / goal.targetAmountPaise) * 100) : 0,
      allocations,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    };
  }));
  return serialized;
}

export async function listSavingsGoals(userId: string, query: { page?: number; limit?: number; status?: string } = {}) {
  const filter: Record<string, unknown> = { userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } };
  if (query.status) filter.status = query.status;
  const { page, limit, skip } = normalizePagination(query);
  const [total, goals] = await Promise.all([
    SavingsGoalModel.countDocuments(filter),
    SavingsGoalModel.find(filter).sort({ targetDate: 1, createdAt: -1, _id: -1 }).skip(skip).limit(limit),
  ]);
  const items = await serializeGoals(goals, userId);
  if (query.page === undefined && query.limit === undefined && query.status === undefined) return items;
  return { items, ...buildPaginationMeta(total, page, limit) };
}

export async function createSavingsGoal(userId: string, input: Required<Pick<SavingsGoalInput, 'name' | 'targetAmount' | 'targetDate' | 'allocations'>> & SavingsGoalInput) {
  if (input.targetAmount <= 0) throw new ValidationError('Target amount must be greater than zero');
  if (input.status && input.status !== 'ACTIVE') throw new ValidationError('Savings goals must be created active');
  validateAllocations(input.allocations);
  const goal = await SavingsGoalModel.create({
    userId: toObjectId(userId, 'userId'),
    name: input.name.trim(),
    targetAmountPaise: toPaise(input.targetAmount),
    targetDate: startOfDayIST(input.targetDate),
    notes: input.notes ?? '',
    status: 'ACTIVE',
    allocations: input.allocations.map((allocation) => ({
      name: allocation.name.trim(),
      optionType: allocation.optionType,
      expectedAnnualReturnRate: allocation.expectedAnnualReturnRate,
      compoundingFrequency: allocation.compoundingFrequency,
      monthlyContributionPaise: toPaise(allocation.monthlyContribution),
    })),
  });
  return (await serializeGoals([goal], userId))[0];
}

export async function updateSavingsGoal(userId: string, id: string, input: SavingsGoalInput) {
  const goal = await SavingsGoalModel.findOne({ _id: toObjectId(id), userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } });
  if (!goal) throw new NotFoundError('Savings goal');
  const updatesDetails = input.name !== undefined || input.targetAmount !== undefined || input.targetDate !== undefined || input.notes !== undefined || input.allocations !== undefined;
  if (goal.status !== 'ACTIVE' && updatesDetails) throw new ConflictError('Reopen the savings goal before editing it.');
  if (input.status !== undefined && input.status !== goal.status && updatesDetails) {
    throw new ValidationError('Change savings goal details separately from its status.');
  }
  if (input.status !== undefined && goal.status !== 'ACTIVE' && input.status !== 'ACTIVE') {
    throw new ValidationError('Paused, completed, or archived savings goals can only be reopened.');
  }

  if (input.allocations) {
    validateAllocations(input.allocations);
    const activeAllocations = goal.allocations.filter((allocation) => !allocation.isDeleted);
    const originalIds = new Set(activeAllocations.map((allocation) => allocation._id.toString()));
    const incomingIds = input.allocations.map((allocation) => allocation.id).filter((value): value is string => Boolean(value));
    if (new Set(incomingIds).size !== incomingIds.length || incomingIds.some((allocationId) => !originalIds.has(allocationId))) {
      throw new ValidationError('Savings allocation IDs must be unique and belong to this goal');
    }
    for (const allocation of activeAllocations) {
      const next = input.allocations.find((candidate) => candidate.id === allocation._id.toString());
      const linkedMovements = await TransactionModel.exists({ userId, savingsGoalId: goal._id, savingsAllocationId: allocation._id.toString(), isDeleted: false });
      if (linkedMovements && !next) {
        throw new ConflictError('Allocations with linked transfers cannot be removed.');
      }
      if (!next) allocation.isDeleted = true;
    }
    for (const allocation of input.allocations) {
      const existing = allocation.id ? goal.allocations.id(allocation.id) : null;
      if (existing) {
        existing.name = allocation.name.trim();
        existing.optionType = allocation.optionType;
        existing.expectedAnnualReturnRate = allocation.expectedAnnualReturnRate;
        existing.compoundingFrequency = allocation.compoundingFrequency;
        existing.monthlyContributionPaise = toPaise(allocation.monthlyContribution);
        existing.isDeleted = false;
      } else {
        goal.allocations.push({
          name: allocation.name.trim(),
          optionType: allocation.optionType,
          expectedAnnualReturnRate: allocation.expectedAnnualReturnRate,
          compoundingFrequency: allocation.compoundingFrequency,
          monthlyContributionPaise: toPaise(allocation.monthlyContribution),
        });
      }
    }
  }
  if (input.name !== undefined) goal.name = input.name.trim();
  if (input.targetAmount !== undefined) {
    if (input.targetAmount <= 0) throw new ValidationError('Target amount must be greater than zero');
    goal.targetAmountPaise = toPaise(input.targetAmount);
  }
  if (input.targetDate !== undefined) goal.targetDate = startOfDayIST(input.targetDate);
  if (input.notes !== undefined) goal.notes = input.notes;
  if (input.status !== undefined && input.status !== goal.status) {
    if (input.status === 'ACTIVE') {
      validateAllocations(goal.allocations.filter((allocation) => !allocation.isDeleted).map((allocation) => ({
        id: allocation._id.toString(),
        name: allocation.name,
        optionType: allocation.optionType,
        expectedAnnualReturnRate: allocation.expectedAnnualReturnRate,
        compoundingFrequency: allocation.compoundingFrequency,
        monthlyContribution: toRupees(allocation.monthlyContributionPaise),
      })));
    }
    goal.status = input.status;
  }
  await goal.save();
  return (await serializeGoals([goal], userId))[0];
}

export async function deleteSavingsGoal(userId: string, id: string) {
  const uid = toObjectId(userId, 'userId');
  const goal = await SavingsGoalModel.findOne({ _id: toObjectId(id), userId: uid, isDeleted: { $ne: true } });
  if (!goal) throw new NotFoundError('Savings goal');
  const hasLinkedTransfers = await TransactionModel.exists({ userId: uid, savingsGoalId: goal._id, isDeleted: false });
  if (hasLinkedTransfers) {
    throw new ConflictError('Savings goals with transfer history cannot be deleted. Archive the goal to preserve its history.');
  }
  goal.isDeleted = true;
  await goal.save();
  return { id: goal._id.toString() };
}

export async function recordSavingsMovement(
  userId: string,
  goalId: string,
  allocationId: string,
  input: {
    direction: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number;
    transactionDate: string;
    counterpartAccountId: string;
    paymentMode: PaymentMode;
    categoryId: string;
    note?: string;
  },
  idempotencyKey?: string,
) {
  const goal = await SavingsGoalModel.findOne({ _id: toObjectId(goalId), userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } });
  if (!goal) throw new NotFoundError('Savings goal');
  if (goal.status !== 'ACTIVE') throw new ConflictError('Only active savings goals can record money movements.');
  const allocation = goal.allocations.id(allocationId);
  if (!allocation) throw new NotFoundError('Savings allocation');
  const amountPaise = toPaise(input.amount);
  if (amountPaise <= 0) throw new ValidationError('Amount must be greater than zero');
  const counterpart = await AccountModel.findOne({
    _id: toObjectId(input.counterpartAccountId, 'counterpartAccountId'),
    userId: toObjectId(userId, 'userId'),
    isArchived: false,
    isActive: true,
  });
  if (!counterpart) throw new NotFoundError('Active counterpart account');
  const transferCategory = await CategoryModel.findOne({
    _id: toObjectId(input.categoryId, 'categoryId'),
    userId: toObjectId(userId, 'userId'),
    type: 'TRANSFER',
    isArchived: false,
  });
  if (!transferCategory) throw new NotFoundError('Transfer category');
  const sourceBalancePaise = input.direction === 'DEPOSIT'
    ? await accountService.getBalancePaise(userId, counterpart._id.toString())
    : 0;
  if (input.direction === 'WITHDRAWAL') {
    const linkedMovements = await TransactionModel.find({
      userId: toObjectId(userId, 'userId'),
      savingsGoalId: goal._id,
      savingsAllocationId: allocation._id.toString(),
      isDeleted: false,
      type: 'TRANSFER',
    }).select('accountId toAccountId amountPaise savingsMovementDirection');
    const allocationBalancePaise = linkedMovements.reduce((balance, movement) => (
      movement.savingsMovementDirection === 'DEPOSIT' || (
        !movement.savingsMovementDirection && allocation.accountId && movement.toAccountId?.toString() === allocation.accountId.toString()
      )
        ? addPaise(balance, movement.amountPaise)
        : subtractPaise(balance, movement.amountPaise)
    ), 0);
    if (amountPaise > allocationBalancePaise) {
      throw new ValidationError('Withdrawal exceeds the amount recorded for this savings goal');
    }
  }
  if (input.direction === 'DEPOSIT' && amountPaise > sourceBalancePaise) {
    throw new ValidationError(input.direction === 'DEPOSIT'
      ? 'Deposit exceeds the source account balance'
      : 'Withdrawal exceeds the savings account balance');
  }

  await createTransaction(
    userId,
    {
      type: 'TRANSFER',
      amount: input.amount,
      transactionDate: input.transactionDate,
      accountId: counterpart._id.toString(),
      categoryId: input.categoryId,
      paymentMode: input.paymentMode,
      description: `${input.direction === 'DEPOSIT' ? 'Savings deposit' : 'Savings withdrawal'} · ${goal.name} / ${allocation.name}`,
      note: input.note ?? '',
      idempotencyKey,
    },
    idempotencyKey,
    undefined,
    undefined,
    { savingsGoalId: goal._id.toString(), savingsAllocationId: allocation._id.toString(), savingsMovementDirection: input.direction },
  );
  const refreshed = await SavingsGoalModel.findOne({ _id: goal._id, userId: toObjectId(userId, 'userId'), isDeleted: { $ne: true } });
  return (await serializeGoals(refreshed ? [refreshed] : [], userId))[0];
}