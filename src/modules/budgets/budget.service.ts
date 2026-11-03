import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import { BUDGET_THRESHOLDS } from '../../shared/constants/index.js';
import { endOfMonthIST, nowInIST, startOfMonthIST } from '../../shared/utils/date.js';
import { addPaise, percentage, subtractPaise, toPaise, toRupees } from '../../shared/utils/money.js';
import { CategoryModel } from '../categories/category.model.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import { MonthlyBudgetModel } from './budget.model.js';

function utilizationStatus(pct: number) {
  if (pct >= BUDGET_THRESHOLDS.HIGH) return 'exceeded';
  if (pct >= BUDGET_THRESHOLDS.WARNING) return 'high';
  if (pct >= BUDGET_THRESHOLDS.NORMAL) return 'warning';
  return 'normal';
}

export async function getBudget(userId: string, year: number, month: number) {
  const budget = await MonthlyBudgetModel.findOne({ userId, year, month });
  if (!budget) return null;
  return enrichBudget(userId, budget);
}

export async function listBudgets(userId: string) {
  const budgets = await MonthlyBudgetModel.find({ userId }).sort({ year: -1, month: -1 });
  return Promise.all(budgets.map((b) => enrichBudget(userId, b)));
}

export async function getMonthlySpendingByCategory(userId: string, year: number, month: number) {
  const from = startOfMonthIST(year, month);
  const to = endOfMonthIST(year, month);
  const [transactions, categories] = await Promise.all([
    TransactionModel.find({
      userId,
      isDeleted: false,
      transactionDate: { $gte: from, $lte: to },
      type: { $in: ['EXPENSE', 'REFUND'] },
    }).select('type amountPaise categoryId'),
    CategoryModel.find({ userId }).select('_id name icon color isArchived').lean(),
  ]);

  const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));
  const spending = new Map<string, { spentPaise: number; expenseCount: number }>();
  for (const transaction of transactions) {
    const categoryId = transaction.categoryId.toString();
    const current = spending.get(categoryId) ?? { spentPaise: 0, expenseCount: 0 };
    if (transaction.type === 'EXPENSE') {
      current.spentPaise = addPaise(current.spentPaise, transaction.amountPaise);
      current.expenseCount += 1;
    } else {
      current.spentPaise = subtractPaise(current.spentPaise, transaction.amountPaise);
    }
    spending.set(categoryId, current);
  }

  return [...spending.entries()]
    .filter(([, value]) => value.expenseCount > 0)
    .map(([categoryId, value]) => {
      const category = categoryById.get(categoryId);
      return {
        categoryId,
        categoryName: category?.name ?? 'Deleted category',
        icon: category?.icon ?? 'circle',
        color: category?.color ?? '#64748B',
        isArchived: category?.isArchived ?? true,
        actualSpent: toRupees(Math.max(0, value.spentPaise)),
        transactionCount: value.expenseCount,
      };
    })
    .sort((a, b) => b.actualSpent - a.actualSpent);
}

export async function createBudget(
  userId: string,
  data: {
    year: number;
    month: number;
    items: Array<{ categoryId: string; amount: number }>;
    notes?: string;
  },
) {
  const existing = await MonthlyBudgetModel.findOne({
    userId,
    year: data.year,
    month: data.month,
  });
  if (existing) {
    throw new ConflictError('Budget for this month already exists. Use update or copy.');
  }

  const budget = await MonthlyBudgetModel.create({
    userId,
    year: data.year,
    month: data.month,
    notes: data.notes ?? '',
    items: data.items.map((i) => ({
      categoryId: i.categoryId,
      amountPaise: toPaise(i.amount),
    })),
  });
  return enrichBudget(userId, budget);
}

export async function updateBudget(
  userId: string,
  id: string,
  data: {
    items?: Array<{ categoryId: string; amount: number }>;
    notes?: string;
  },
) {
  const budget = await MonthlyBudgetModel.findOne({ _id: id, userId });
  if (!budget) throw new NotFoundError('Budget');
  if (data.items) {
    budget.set('items', data.items.map((i) => ({
      categoryId: i.categoryId as unknown as typeof budget.items[0]['categoryId'],
      amountPaise: toPaise(i.amount),
    })));
  }
  if (data.notes !== undefined) budget.notes = data.notes;
  await budget.save();
  return enrichBudget(userId, budget);
}

export async function copyBudget(
  userId: string,
  data: {
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
    overwrite?: boolean;
  },
) {
  const source = await MonthlyBudgetModel.findOne({
    userId,
    year: data.fromYear,
    month: data.fromMonth,
  });
  if (!source) throw new NotFoundError('Source budget');

  const existing = await MonthlyBudgetModel.findOne({
    userId,
    year: data.toYear,
    month: data.toMonth,
  });

  if (existing && !data.overwrite) {
    throw new ValidationError('Target month budget exists. Set overwrite=true to replace.');
  }

  if (existing && data.overwrite) {
    existing.items = source.items;
    existing.notes = source.notes;
    await existing.save();
    return enrichBudget(userId, existing);
  }

  const created = await MonthlyBudgetModel.create({
    userId,
    year: data.toYear,
    month: data.toMonth,
    items: source.items,
    notes: source.notes,
  });
  return enrichBudget(userId, created);
}

async function enrichBudget(
  userId: string,
  budget: {
    _id: { toString(): string };
    year: number;
    month: number;
    notes?: string;
    items: Array<{ categoryId: { toString(): string }; amountPaise: number }>;
  },
) {
  const from = startOfMonthIST(budget.year, budget.month);
  const to = endOfMonthIST(budget.year, budget.month);
  const now = nowInIST();
  const daysInMonth = to.getDate();
  const dayOfMonth =
    now.year() === budget.year && now.month() + 1 === budget.month
      ? now.date()
      : daysInMonth;

  const expenses = await TransactionModel.find({
    userId,
    isDeleted: false,
    transactionDate: { $gte: from, $lte: to },
    type: { $in: ['EXPENSE', 'REFUND'] },
  }).select('type amountPaise categoryId');

  const spentByCategory = new Map<string, { spentPaise: number; count: number }>();

  for (const tx of expenses) {
    const catId = tx.categoryId.toString();
    const current = spentByCategory.get(catId) ?? { spentPaise: 0, count: 0 };
    if (tx.type === 'EXPENSE') {
      current.spentPaise = addPaise(current.spentPaise, tx.amountPaise);
      current.count += 1;
    } else if (tx.type === 'REFUND') {
      current.spentPaise = subtractPaise(current.spentPaise, tx.amountPaise);
    }
    spentByCategory.set(catId, current);
  }

  let totalBudgetPaise = 0;
  let totalSpentPaise = 0;

  const items = budget.items.map((item) => {
    const catId = item.categoryId.toString();
    const spent = spentByCategory.get(catId) ?? { spentPaise: 0, count: 0 };
    const remainingPaise = subtractPaise(item.amountPaise, spent.spentPaise);
    const utilization = percentage(spent.spentPaise, item.amountPaise);
    const avgDailyPaise = dayOfMonth > 0 ? Math.round(spent.spentPaise / dayOfMonth) : 0;
    const projectedPaise = avgDailyPaise * daysInMonth;

    totalBudgetPaise = addPaise(totalBudgetPaise, item.amountPaise);
    totalSpentPaise = addPaise(totalSpentPaise, Math.max(0, spent.spentPaise));

    return {
      categoryId: catId,
      budgetAmount: toRupees(item.amountPaise),
      actualSpent: toRupees(Math.max(0, spent.spentPaise)),
      remaining: toRupees(remainingPaise),
      utilizationPercent: utilization,
      status: utilizationStatus(utilization),
      overBudget: toRupees(Math.max(0, subtractPaise(spent.spentPaise, item.amountPaise))),
      transactionCount: spent.count,
      averageDailySpend: toRupees(avgDailyPaise),
      projectedMonthEnd: toRupees(projectedPaise),
    };
  });

  const totalUtilization = percentage(totalSpentPaise, totalBudgetPaise);

  return {
    id: budget._id.toString(),
    year: budget.year,
    month: budget.month,
    notes: budget.notes ?? '',
    items,
    summary: {
      totalBudget: toRupees(totalBudgetPaise),
      totalSpent: toRupees(totalSpentPaise),
      remaining: toRupees(subtractPaise(totalBudgetPaise, totalSpentPaise)),
      utilizationPercent: totalUtilization,
      status: utilizationStatus(totalUtilization),
      projectedMonthEnd: toRupees(
        dayOfMonth > 0 ? Math.round((totalSpentPaise / dayOfMonth) * daysInMonth) : 0,
      ),
    },
  };
}
