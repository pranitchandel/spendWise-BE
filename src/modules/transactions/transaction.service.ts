import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError.js';
import { endOfDayIST, parseDateInIST, startOfDayIST } from '../../shared/utils/date.js';
import { addPaise, subtractPaise, toPaise, toRupees } from '../../shared/utils/money.js';
import { canRefundAmount } from './ledger.js';
import { AccountModel } from '../accounts/account.model.js';
import { CategoryModel } from '../categories/category.model.js';
import { LendingRecordModel } from '../lending/lending.model.js';
import { BorrowingRecordModel } from '../borrowing/borrowing.model.js';
import { RepaymentModel } from '../repayments/repayment.model.js';
import { PersonModel } from '../people/person.model.js';
import { RecurringOccurrenceModel } from '../recurring/recurring.model.js';
import { PlannedExpenseModel } from '../planned-expenses/planned-expense.model.js';
import { PlannedIncomeModel } from '../planned-incomes/planned-income.model.js';
import { TransactionModel, type TransactionDocument } from './transaction.model.js';
import { toTransactionDto } from './transaction.mapper.js';
import { recordTransactionActivity } from '../activity-logs/activity-log.service.js';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './transaction.types.js';

async function assertAccount(userId: string, accountId: string, session?: mongoose.ClientSession) {
  const account = await AccountModel.findOne({ _id: accountId, userId, isArchived: false }).session(
    session ?? null,
  );
  if (!account) throw new NotFoundError('Account');
  return account;
}

async function assertCategory(userId: string, categoryId: string, session?: mongoose.ClientSession) {
  const category = await CategoryModel.findOne({
    _id: categoryId,
    userId,
    isArchived: false,
  }).session(session ?? null);
  if (!category) throw new NotFoundError('Category');
  return category;
}

async function assertCampaignAllowsTransactionChange(
  userId: string,
  transaction: Pick<TransactionDocument, 'plannedExpenseId' | 'linkedTransactionId' | 'type'>,
  session?: mongoose.ClientSession,
) {
  let campaignId = transaction.plannedExpenseId?.toString();
  if (!campaignId && transaction.type === 'REFUND' && transaction.linkedTransactionId) {
    const original = await TransactionModel.findOne({
      _id: transaction.linkedTransactionId,
      userId,
      type: 'EXPENSE',
    }).select('plannedExpenseId').session(session ?? null);
    campaignId = original?.plannedExpenseId?.toString();
  }
  if (!campaignId) return;

    const campaign = await PlannedExpenseModel.findOne({
      _id: campaignId,
      userId,
      status: 'PLANNED',
      isDeleted: { $ne: true },
  }).session(session ?? null);
  if (!campaign) {
    throw new ConflictError('Reopen the campaign before editing or deleting its linked transactions.');
  }
}

async function assertSavingsAllowsTransactionChange(
  _userId: string,
  transaction: Pick<TransactionDocument, 'savingsGoalId'>,
  _session?: mongoose.ClientSession,
) {
  if (!transaction.savingsGoalId) return;
  throw new ConflictError('Manage savings-linked movements from the Savings section.');
}

async function assertPlannedIncomeAllowsTransactionChange(
  userId: string,
  transaction: Pick<TransactionDocument, 'plannedIncomeId'>,
  session?: mongoose.ClientSession,
) {
  if (!transaction.plannedIncomeId) return;
  const plan = await PlannedIncomeModel.findOne({
    _id: transaction.plannedIncomeId,
    userId,
    status: 'ACTIVE',
      isDeleted: { $ne: true },
    }).session(session ?? null);
  if (!plan) throw new ConflictError('Reopen the income plan before editing or deleting its linked actuals.');
}

async function serializeTransactionsWithCampaignStatus(userId: string, transactions: TransactionDocument[]) {
  if (!transactions.length) return [];

  const campaignByTransactionId = new Map<string, string>();
  const refundOriginalIds: mongoose.Types.ObjectId[] = [];
  for (const transaction of transactions) {
    if (transaction.plannedExpenseId) {
      campaignByTransactionId.set(transaction._id.toString(), transaction.plannedExpenseId.toString());
    } else if (transaction.type === 'REFUND' && transaction.linkedTransactionId) {
      refundOriginalIds.push(transaction.linkedTransactionId);
    }
  }

  if (refundOriginalIds.length) {
    const originals = await TransactionModel.find({
      _id: { $in: refundOriginalIds },
      userId,
      type: 'EXPENSE',
    }).select('_id plannedExpenseId').lean();
    const campaignByOriginalId = new Map(
      originals
        .filter((original) => original.plannedExpenseId)
        .map((original) => [original._id.toString(), original.plannedExpenseId!.toString()]),
    );
    for (const transaction of transactions) {
      if (transaction.type !== 'REFUND' || !transaction.linkedTransactionId) continue;
      const campaignId = campaignByOriginalId.get(transaction.linkedTransactionId.toString());
      if (campaignId) campaignByTransactionId.set(transaction._id.toString(), campaignId);
    }
  }

  const campaignIds = [...new Set(campaignByTransactionId.values())].map((id) => new mongoose.Types.ObjectId(id));
  const campaigns = campaignIds.length
    ? await PlannedExpenseModel.find({ _id: { $in: campaignIds }, userId }).select('_id status').lean()
    : [];
  const statusByCampaignId = new Map(campaigns.map((campaign) => [campaign._id.toString(), campaign.status]));

  return transactions.map((transaction) => {
    const campaignId = campaignByTransactionId.get(transaction._id.toString());
    return {
      ...toTransactionDto(transaction),
      plannedExpenseId: campaignId ?? transaction.plannedExpenseId?.toString() ?? null,
      plannedExpenseStatus: campaignId ? statusByCampaignId.get(campaignId) ?? null : null,
    };
  });
}

async function resolvePerson(
  userId: string,
  input: CreateTransactionInput,
  session: mongoose.ClientSession,
) {
  if (input.personId) {
    const person = await PersonModel.findOne({ _id: input.personId, userId }).session(session);
    if (!person) throw new NotFoundError('Person');
    return person;
  }
  if (input.personName) {
    const person = await PersonModel.create(
      [
        {
          userId,
          name: input.personName,
          phone: input.phone ?? '',
          email: input.email ?? '',
        },
      ],
      { session },
    );
    return person[0];
  }
  return null;
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
  idempotencyKey?: string,
  transactionSession?: mongoose.ClientSession,
  plannedExpenseLink?: { plannedExpenseId: string; plannedExpenseItemId: string },
  savingsLink?: { savingsGoalId: string; savingsAllocationId: string; savingsMovementDirection: 'DEPOSIT' | 'WITHDRAWAL' },
  plannedIncomeLink?: { plannedIncomeId: string; plannedIncomeOccurrenceDate: string },
) {
  const key = idempotencyKey ?? input.idempotencyKey;
  if (key) {
    const existing = await TransactionModel.findOne({ userId, idempotencyKey: key }).session(
      transactionSession ?? null,
    );
    if (existing) {
      throw new IdempotencyConflictError('Duplicate financial request');
    }
  }

  const amountPaise = toPaise(input.amount);
  if (amountPaise <= 0) throw new ValidationError('Amount must be greater than zero');
  const interestPaise = toPaise(input.interestAmount ?? 0);
  const txDate = startOfDayIST(input.transactionDate);

  if (savingsLink && input.type !== 'TRANSFER') {
    throw new ValidationError('Savings movements must be recorded as transfers');
  }
  if (plannedIncomeLink && input.type !== 'INCOME') {
    throw new ValidationError('Planned income actuals must be recorded as income');
  }
  if (input.type === 'TRANSFER' && !input.toAccountId && !savingsLink) {
    throw new ValidationError('toAccountId is required for transfers');
  }
  if (input.type === 'TRANSFER' && input.toAccountId === input.accountId) {
    throw new ValidationError('Cannot transfer to the same account');
  }
  if (
    (input.type === 'LENDING_REPAYMENT' || input.type === 'BORROWING_REPAYMENT') &&
    !input.linkedRecordId
  ) {
    throw new ValidationError('linkedRecordId is required for repayments');
  }
  if (input.type === 'REFUND' && !input.linkedTransactionId) {
    throw new ValidationError('linkedTransactionId is required for refunds');
  }

  const ownsSession = !transactionSession;
  const session = transactionSession ?? (await mongoose.startSession());
  if (ownsSession) session.startTransaction();

  try {
    await assertAccount(userId, input.accountId, session);
    if (input.toAccountId) await assertAccount(userId, input.toAccountId, session);
    await assertCategory(userId, input.categoryId, session);

    if (input.type === 'REFUND') {
      const original = await TransactionModel.findOne({
        _id: input.linkedTransactionId,
        userId,
        type: 'EXPENSE',
        isDeleted: false,
      }).session(session);
      if (!original) throw new NotFoundError('Original expense transaction');
      if (String(original.categoryId) !== input.categoryId) {
        throw new ValidationError('Refund category must match the original expense');
      }
      if (!canRefundAmount(original.amountPaise, original.refundedPaise, amountPaise)) {
        throw new ValidationError('Refund exceeds the remaining refundable amount');
      }

      const updatedOriginal = await TransactionModel.findOneAndUpdate(
        {
          _id: original._id,
          userId,
          type: 'EXPENSE',
          isDeleted: false,
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ['$refundedPaise', 0] }, amountPaise] },
              '$amountPaise',
            ],
          },
        },
        { $inc: { refundedPaise: amountPaise } },
        { returnDocument: 'after', session },
      );
      if (!updatedOriginal) {
        throw new ValidationError('Refund exceeds the remaining refundable amount');
      }
    }

    const person = await resolvePerson(userId, input, session);
    const transferGroupId = input.type === 'TRANSFER' && input.toAccountId ? randomUUID() : null;

    const [tx] = await TransactionModel.create(
      [
        {
          userId,
          amountPaise,
          interestPaise,
          transactionDate: txDate,
          transactionTime: input.transactionTime ?? '',
          type: input.type,
          categoryId: input.categoryId,
          paymentMode: input.paymentMode,
          accountId: input.accountId,
          toAccountId: input.toAccountId ?? null,
          description: input.description ?? '',
          note: input.note ?? '',
          tags: input.tags ?? [],
          personId: person?._id ?? null,
          linkedTransactionId: input.linkedTransactionId ?? null,
          plannedExpenseId: plannedExpenseLink
            ? new mongoose.Types.ObjectId(plannedExpenseLink.plannedExpenseId)
            : null,
          plannedExpenseItemId: plannedExpenseLink?.plannedExpenseItemId ?? null,
          savingsGoalId: savingsLink ? new mongoose.Types.ObjectId(savingsLink.savingsGoalId) : null,
          savingsAllocationId: savingsLink?.savingsAllocationId ?? null,
          savingsMovementDirection: savingsLink?.savingsMovementDirection ?? null,
          plannedIncomeId: plannedIncomeLink ? new mongoose.Types.ObjectId(plannedIncomeLink.plannedIncomeId) : null,
          plannedIncomeOccurrenceDate: plannedIncomeLink ? startOfDayIST(plannedIncomeLink.plannedIncomeOccurrenceDate) : null,
          transferGroupId,
          isCreditCardBillPayment: input.isCreditCardBillPayment ?? false,
          idempotencyKey: key ?? null,
        },
      ],
      { session },
    );

    if (input.type === 'LENDING') {
      const [record] = await LendingRecordModel.create(
        [
          {
            userId,
            personId: person?._id ?? null,
            personName: person?.name ?? input.personName ?? 'Unknown',
            phone: person?.phone ?? input.phone ?? '',
            email: person?.email ?? input.email ?? '',
            originalAmountPaise: amountPaise,
            lendingDate: txDate,
            sourceAccountId: input.accountId,
            expectedRepaymentDate: input.expectedRepaymentDate
              ? startOfDayIST(input.expectedRepaymentDate)
              : null,
            interestRate: input.interestRate ?? null,
            description: input.description ?? '',
            notes: input.note ?? '',
            status: 'ACTIVE',
            outstandingPaise: amountPaise,
            totalRepaidPaise: 0,
            linkedTransactionId: tx._id,
          },
        ],
        { session },
      );
      tx.linkedRecordId = record._id;
      tx.linkedRecordType = 'LENDING';
      await tx.save({ session });
    }

    if (input.type === 'BORROWING') {
      const [record] = await BorrowingRecordModel.create(
        [
          {
            userId,
            personId: person?._id ?? null,
            lenderName: person?.name ?? input.personName ?? 'Unknown',
            phone: person?.phone ?? input.phone ?? '',
            email: person?.email ?? input.email ?? '',
            originalAmountPaise: amountPaise,
            borrowingDate: txDate,
            receivingAccountId: input.accountId,
            expectedRepaymentDate: input.expectedRepaymentDate
              ? startOfDayIST(input.expectedRepaymentDate)
              : null,
            interestRate: input.interestRate ?? null,
            repaymentTerms: input.repaymentTerms ?? '',
            notes: input.note ?? '',
            status: 'ACTIVE',
            outstandingPaise: amountPaise,
            totalRepaidPaise: 0,
            linkedTransactionId: tx._id,
          },
        ],
        { session },
      );
      tx.linkedRecordId = record._id;
      tx.linkedRecordType = 'BORROWING';
      await tx.save({ session });
    }

    if (input.type === 'LENDING_REPAYMENT') {
      await applyLendingRepayment(
        userId,
        input.linkedRecordId!,
        amountPaise,
        interestPaise,
        tx._id.toString(),
        input.accountId,
        txDate,
        input.note ?? '',
        session,
      );
      tx.linkedRecordId = new mongoose.Types.ObjectId(input.linkedRecordId!);
      tx.linkedRecordType = 'LENDING';
      await tx.save({ session });
    }

    if (input.type === 'BORROWING_REPAYMENT') {
      await applyBorrowingRepayment(
        userId,
        input.linkedRecordId!,
        amountPaise,
        interestPaise,
        tx._id.toString(),
        input.accountId,
        txDate,
        input.note ?? '',
        session,
      );
      tx.linkedRecordId = new mongoose.Types.ObjectId(input.linkedRecordId!);
      tx.linkedRecordType = 'BORROWING';
      await tx.save({ session });
    }

    await recordTransactionActivity(userId, { action: 'CREATED', after: toTransactionDto(tx) }, session);
    if (ownsSession) await session.commitTransaction();
    return toTransactionDto(tx);
  } catch (err) {
    if (ownsSession) await session.abortTransaction();
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      throw new IdempotencyConflictError();
    }
    throw err;
  } finally {
    if (ownsSession) session.endSession();
  }
}

async function applyLendingRepayment(
  userId: string,
  recordId: string,
  amountPaise: number,
  interestPaise: number,
  transactionId: string,
  accountId: string,
  repaymentDate: Date,
  notes: string,
  session: mongoose.ClientSession,
) {
  const record = await LendingRecordModel.findOne({ _id: recordId, userId }).session(session);
  if (!record) throw new NotFoundError('Lending record');
  if (record.status === 'REPAID' || record.status === 'WRITTEN_OFF') {
    throw new ValidationError('Lending record is already closed');
  }

  const principalPortion = Math.min(amountPaise, record.outstandingPaise);
  const overflow = subtractPaise(amountPaise, principalPortion);
  if (overflow > 0 && interestPaise < overflow) {
    throw new ValidationError(
      'Repayment exceeds outstanding principal. Classify excess as interestAmount.',
    );
  }

  record.outstandingPaise = subtractPaise(record.outstandingPaise, principalPortion);
  record.totalRepaidPaise = addPaise(record.totalRepaidPaise, principalPortion);
  record.totalInterestReceivedPaise = addPaise(
    record.totalInterestReceivedPaise,
    interestPaise || overflow,
  );

  if (record.outstandingPaise === 0) record.status = 'REPAID';
  else record.status = 'PARTIALLY_REPAID';

  await record.save({ session });
  await RepaymentModel.create(
    [
      {
        userId,
        recordType: 'LENDING',
        recordId: record._id,
        personId: record.personId,
        amountPaise: principalPortion,
        interestPaise: interestPaise || overflow,
        transactionId,
        accountId,
        repaymentDate,
        notes,
      },
    ],
    { session },
  );
}

async function applyBorrowingRepayment(
  userId: string,
  recordId: string,
  amountPaise: number,
  interestPaise: number,
  transactionId: string,
  accountId: string,
  repaymentDate: Date,
  notes: string,
  session: mongoose.ClientSession,
) {
  const record = await BorrowingRecordModel.findOne({ _id: recordId, userId }).session(session);
  if (!record) throw new NotFoundError('Borrowing record');
  if (record.status === 'REPAID' || record.status === 'WRITTEN_OFF') {
    throw new ValidationError('Borrowing record is already closed');
  }

  const principalPortion = Math.min(amountPaise, record.outstandingPaise);
  const overflow = subtractPaise(amountPaise, principalPortion);
  if (overflow > 0 && interestPaise < overflow) {
    throw new ValidationError(
      'Repayment exceeds outstanding principal. Classify excess as interestAmount.',
    );
  }

  record.outstandingPaise = subtractPaise(record.outstandingPaise, principalPortion);
  record.totalRepaidPaise = addPaise(record.totalRepaidPaise, principalPortion);
  record.totalInterestPaidPaise = addPaise(
    record.totalInterestPaidPaise,
    interestPaise || overflow,
  );

  if (record.outstandingPaise === 0) record.status = 'REPAID';
  else record.status = 'PARTIALLY_REPAID';

  await record.save({ session });
  await RepaymentModel.create(
    [
      {
        userId,
        recordType: 'BORROWING',
        recordId: record._id,
        personId: record.personId,
        amountPaise: principalPortion,
        interestPaise: interestPaise || overflow,
        transactionId,
        accountId,
        repaymentDate,
        notes,
      },
    ],
    { session },
  );
}

export async function listTransactions(userId: string, query: ListTransactionsQuery) {
  const filter: Record<string, unknown> = { userId, isDeleted: false };
  if (query.type) filter.type = query.type;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.accountId) {
    filter.$or = [{ accountId: query.accountId }, { toAccountId: query.accountId }];
  }
  if (query.search) {
    filter.$or = [
      { description: { $regex: query.search, $options: 'i' } },
      { note: { $regex: query.search, $options: 'i' } },
      { tags: { $regex: query.search, $options: 'i' } },
    ];
  }
  if (query.tags) filter.tags = { $in: query.tags.split(',') };
  if (query.from || query.to) {
    filter.transactionDate = {};
    if (query.from) {
      (filter.transactionDate as Record<string, Date>).$gte = startOfDayIST(query.from);
    }
    if (query.to) {
      (filter.transactionDate as Record<string, Date>).$lte = endOfDayIST(query.to);
    }
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = {
    [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1,
  };

  const [items, total] = await Promise.all([
    TransactionModel.find(filter).sort(sort).skip(skip).limit(query.limit),
    TransactionModel.countDocuments(filter),
  ]);

  return {
    items: await serializeTransactionsWithCampaignStatus(userId, items),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getTransaction(userId: string, id: string) {
  const tx = await TransactionModel.findOne({ _id: id, userId, isDeleted: false });
  if (!tx) throw new NotFoundError('Transaction');
  return (await serializeTransactionsWithCampaignStatus(userId, [tx]))[0];
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: UpdateTransactionInput,
) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tx = await TransactionModel.findOne({ _id: id, userId, isDeleted: false }).session(session);
    if (!tx) throw new NotFoundError('Transaction');
    const before = toTransactionDto(tx);
    await assertCampaignAllowsTransactionChange(userId, tx, session);
    await assertSavingsAllowsTransactionChange(userId, tx, session);
    await assertPlannedIncomeAllowsTransactionChange(userId, tx, session);
    await assertPlannedIncomeAllowsTransactionChange(userId, tx, session);

    const oldAmountPaise = tx.amountPaise;
    const nextAmountPaise = input.amount === undefined ? oldAmountPaise : toPaise(input.amount);
    if (nextAmountPaise <= 0) throw new ValidationError('Amount must be greater than zero');
    const nextDate = input.transactionDate ? startOfDayIST(input.transactionDate) : tx.transactionDate;
    const nextAccountId = input.accountId ?? tx.accountId.toString();
    const nextCategoryId = input.categoryId ?? tx.categoryId.toString();

    if (tx.savingsGoalId && (
      nextAccountId !== tx.accountId.toString() ||
      (input.toAccountId !== undefined && input.toAccountId !== tx.toAccountId?.toString())
    )) {
      throw new ConflictError('Savings-linked transfers cannot be redirected in the transaction editor.');
    }

    await assertAccount(userId, nextAccountId, session);
    const category = await assertCategory(userId, nextCategoryId, session);
    const expectedCategoryType = tx.type === 'LENDING_REPAYMENT'
      ? 'LENDING'
      : tx.type === 'BORROWING_REPAYMENT'
        ? 'BORROWING'
        : tx.type === 'REFUND'
          ? 'EXPENSE'
        : tx.type;
    if (category.type !== expectedCategoryType) {
      throw new ValidationError(`Category must be a ${expectedCategoryType.toLowerCase()} category`);
    }

    if (tx.type === 'TRANSFER') {
      const nextToAccountId = input.toAccountId === undefined
        ? tx.toAccountId?.toString()
        : input.toAccountId;
      if (!nextToAccountId || nextToAccountId === nextAccountId) {
        throw new ValidationError('Transfers require a different destination account');
      }
      await assertAccount(userId, nextToAccountId, session);
      tx.toAccountId = new mongoose.Types.ObjectId(nextToAccountId);
    }

    if (tx.type === 'EXPENSE' && nextAmountPaise < tx.refundedPaise) {
      throw new ValidationError('Expense amount cannot be less than its existing refunds');
    }
    if (
      tx.type === 'EXPENSE' && tx.refundedPaise > 0 &&
      nextCategoryId !== String(tx.categoryId)
    ) {
      throw new ConflictError('Expense category cannot change after a refund has been recorded');
    }

    if (tx.type === 'REFUND') {
      if (!tx.linkedTransactionId) throw new ConflictError('Refund is missing its original expense');
      if (nextCategoryId !== String(tx.categoryId)) {
        throw new ConflictError('Refund category cannot change; it must match the original expense');
      }
      const original = await TransactionModel.findOne({
        _id: tx.linkedTransactionId,
        userId,
        type: 'EXPENSE',
        isDeleted: false,
      }).session(session);
      if (!original) throw new NotFoundError('Original expense transaction');
      const refundedWithoutCurrent = subtractPaise(original.refundedPaise, oldAmountPaise);
      if (!canRefundAmount(original.amountPaise, refundedWithoutCurrent, nextAmountPaise)) {
        throw new ValidationError('Refund exceeds the remaining refundable amount');
      }
      original.refundedPaise = addPaise(refundedWithoutCurrent, nextAmountPaise);
      await original.save({ session });
    }

    if (tx.type === 'LENDING' && tx.linkedRecordId) {
      const record = await LendingRecordModel.findOne({ _id: tx.linkedRecordId, userId }).session(session);
      if (!record) throw new NotFoundError('Lending record');
      const nextOutstanding = addPaise(record.outstandingPaise, subtractPaise(nextAmountPaise, oldAmountPaise));
      if (nextOutstanding < 0) throw new ValidationError('Lending amount cannot be less than repayments already received');
      record.originalAmountPaise = nextAmountPaise;
      record.outstandingPaise = nextOutstanding;
      record.lendingDate = nextDate;
      record.sourceAccountId = new mongoose.Types.ObjectId(nextAccountId);
      if (input.personName !== undefined) record.personName = input.personName.trim();
      if (input.phone !== undefined) record.phone = input.phone;
      if (input.email !== undefined) record.email = input.email;
      if (input.expectedRepaymentDate !== undefined) {
        record.expectedRepaymentDate = input.expectedRepaymentDate
          ? startOfDayIST(input.expectedRepaymentDate)
          : null;
      }
      if (input.interestRate !== undefined) record.interestRate = input.interestRate;
      if (input.description !== undefined) record.description = input.description;
      if (input.note !== undefined) record.notes = input.note;
      record.status = record.outstandingPaise === 0 ? 'REPAID' : record.totalRepaidPaise > 0 ? 'PARTIALLY_REPAID' : 'ACTIVE';
      await record.save({ session });
    }

    if (tx.type === 'BORROWING' && tx.linkedRecordId) {
      const record = await BorrowingRecordModel.findOne({ _id: tx.linkedRecordId, userId }).session(session);
      if (!record) throw new NotFoundError('Borrowing record');
      const nextOutstanding = addPaise(record.outstandingPaise, subtractPaise(nextAmountPaise, oldAmountPaise));
      if (nextOutstanding < 0) throw new ValidationError('Borrowed amount cannot be less than repayments already made');
      record.originalAmountPaise = nextAmountPaise;
      record.outstandingPaise = nextOutstanding;
      record.borrowingDate = nextDate;
      record.receivingAccountId = new mongoose.Types.ObjectId(nextAccountId);
      if (input.personName !== undefined) record.lenderName = input.personName.trim();
      if (input.phone !== undefined) record.phone = input.phone;
      if (input.email !== undefined) record.email = input.email;
      if (input.expectedRepaymentDate !== undefined) {
        record.expectedRepaymentDate = input.expectedRepaymentDate
          ? startOfDayIST(input.expectedRepaymentDate)
          : null;
      }
      if (input.interestRate !== undefined) record.interestRate = input.interestRate;
      if (input.repaymentTerms !== undefined) record.repaymentTerms = input.repaymentTerms;
      if (input.note !== undefined) record.notes = input.note;
      record.status = record.outstandingPaise === 0 ? 'REPAID' : record.totalRepaidPaise > 0 ? 'PARTIALLY_REPAID' : 'ACTIVE';
      await record.save({ session });
    }

    if (tx.type === 'LENDING_REPAYMENT' || tx.type === 'BORROWING_REPAYMENT') {
      const repayment = await RepaymentModel.findOne({ userId, transactionId: tx._id, isDeleted: false }).session(session);
      if (!repayment) throw new NotFoundError('Repayment record');
      const isLending = repayment.recordType === 'LENDING';
      const record = isLending
        ? await LendingRecordModel.findOne({ _id: repayment.recordId, userId }).session(session)
        : await BorrowingRecordModel.findOne({ _id: repayment.recordId, userId }).session(session);
      if (!record) throw new NotFoundError(isLending ? 'Lending record' : 'Borrowing record');

      const restoredOutstanding = addPaise(record.outstandingPaise, repayment.amountPaise);
      const principalPaise = Math.min(nextAmountPaise, restoredOutstanding);
      const overflowPaise = subtractPaise(nextAmountPaise, principalPaise);
      const requestedInterestPaise = input.interestAmount === undefined
        ? tx.interestPaise
        : toPaise(input.interestAmount);
      if (overflowPaise > requestedInterestPaise) {
        throw new ValidationError('Repayment exceeds outstanding principal. Classify excess as interestAmount.');
      }
      const interestPaise = requestedInterestPaise || overflowPaise;
      record.outstandingPaise = subtractPaise(restoredOutstanding, principalPaise);
      record.totalRepaidPaise = addPaise(subtractPaise(record.totalRepaidPaise, repayment.amountPaise), principalPaise);
      if (isLending) {
        const lendingRecord = record as typeof record & { totalInterestReceivedPaise: number };
        lendingRecord.totalInterestReceivedPaise = addPaise(
          subtractPaise(lendingRecord.totalInterestReceivedPaise, repayment.interestPaise), interestPaise,
        );
      } else {
        const borrowingRecord = record as typeof record & { totalInterestPaidPaise: number };
        borrowingRecord.totalInterestPaidPaise = addPaise(
          subtractPaise(borrowingRecord.totalInterestPaidPaise, repayment.interestPaise), interestPaise,
        );
      }
      record.status = record.outstandingPaise === 0 ? 'REPAID' : record.totalRepaidPaise > 0 ? 'PARTIALLY_REPAID' : 'ACTIVE';
      await record.save({ session });
      repayment.amountPaise = principalPaise;
      repayment.interestPaise = interestPaise;
      repayment.repaymentDate = nextDate;
      repayment.accountId = new mongoose.Types.ObjectId(nextAccountId);
      if (input.note !== undefined) repayment.notes = input.note;
      await repayment.save({ session });
      tx.interestPaise = requestedInterestPaise;
    }

    tx.amountPaise = nextAmountPaise;
    tx.transactionDate = nextDate;
    tx.accountId = new mongoose.Types.ObjectId(nextAccountId);
    tx.categoryId = new mongoose.Types.ObjectId(nextCategoryId);
    if (input.transactionTime !== undefined) tx.transactionTime = input.transactionTime;
    if (input.paymentMode !== undefined) tx.paymentMode = input.paymentMode;
    if (input.description !== undefined) tx.description = input.description;
    if (input.note !== undefined) tx.note = input.note;
    if (input.tags !== undefined) tx.tags = input.tags;
    await tx.save({ session });
    await recordTransactionActivity(userId, { action: 'UPDATED', before, after: toTransactionDto(tx) }, session);
    await session.commitTransaction();
    return toTransactionDto(tx);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function deleteTransaction(userId: string, id: string) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tx = await TransactionModel.findOne({ _id: id, userId, isDeleted: false }).session(
      session,
    );
    if (!tx) throw new NotFoundError('Transaction');
    await assertCampaignAllowsTransactionChange(userId, tx, session);
    await assertSavingsAllowsTransactionChange(userId, tx, session);

    if (tx.type === 'EXPENSE') {
      const refund = await TransactionModel.findOne({
        userId,
        type: 'REFUND',
        linkedTransactionId: tx._id,
        isDeleted: false,
      }).session(session);
      if (refund || tx.refundedPaise > 0) {
        throw new ConflictError('Cannot delete an expense with recorded refunds');
      }
    }

    if (tx.type === 'REFUND' && tx.linkedTransactionId) {
      const original = await TransactionModel.findOne({
        _id: tx.linkedTransactionId,
        userId,
        type: 'EXPENSE',
      }).session(session);
      if (!original) throw new ConflictError('Original expense is unavailable for refund deletion');

      const remainingRefunds = await TransactionModel.find({
        userId,
        type: 'REFUND',
        linkedTransactionId: original._id,
        isDeleted: false,
        _id: { $ne: tx._id },
      })
        .select('amountPaise')
        .session(session);
      original.refundedPaise = remainingRefunds.reduce(
        (total, refund) => addPaise(total, refund.amountPaise),
        0,
      );
      await original.save({ session });
    }

    if (tx.type === 'LENDING' && tx.linkedRecordId) {
      const record = await LendingRecordModel.findOne({
        _id: tx.linkedRecordId,
        userId,
        isDeleted: { $ne: true },
      }).session(session);
      if (record && (record.totalRepaidPaise > 0 || record.totalInterestReceivedPaise > 0)) {
        throw new ConflictError('Cannot delete lending with existing repayments');
      }
      if (record) {
        record.isDeleted = true;
        await record.save({ session });
      }
    }

    if (tx.type === 'BORROWING' && tx.linkedRecordId) {
      const record = await BorrowingRecordModel.findOne({
        _id: tx.linkedRecordId,
        userId,
        isDeleted: { $ne: true },
      }).session(session);
      if (record && (record.totalRepaidPaise > 0 || record.totalInterestPaidPaise > 0)) {
        throw new ConflictError('Cannot delete borrowing with existing repayments');
      }
      if (record) {
        record.isDeleted = true;
        await record.save({ session });
      }
    }

    if (tx.type === 'LENDING_REPAYMENT' || tx.type === 'BORROWING_REPAYMENT') {
      const repayment = await RepaymentModel.findOne({
        userId,
        transactionId: tx._id,
        isDeleted: false,
      }).session(session);
      if (!repayment) throw new NotFoundError('Repayment record');

      if (repayment.recordType === 'LENDING') {
        const record = await LendingRecordModel.findOne({ _id: repayment.recordId, userId }).session(session);
        if (!record) throw new NotFoundError('Lending record');
        record.outstandingPaise = addPaise(record.outstandingPaise, repayment.amountPaise);
        record.totalRepaidPaise = subtractPaise(record.totalRepaidPaise, repayment.amountPaise);
        record.totalInterestReceivedPaise = subtractPaise(record.totalInterestReceivedPaise, repayment.interestPaise);
        record.status = record.totalRepaidPaise > 0 ? 'PARTIALLY_REPAID' : 'ACTIVE';
        await record.save({ session });
      } else {
        const record = await BorrowingRecordModel.findOne({ _id: repayment.recordId, userId }).session(session);
        if (!record) throw new NotFoundError('Borrowing record');
        record.outstandingPaise = addPaise(record.outstandingPaise, repayment.amountPaise);
        record.totalRepaidPaise = subtractPaise(record.totalRepaidPaise, repayment.amountPaise);
        record.totalInterestPaidPaise = subtractPaise(record.totalInterestPaidPaise, repayment.interestPaise);
        record.status = record.totalRepaidPaise > 0 ? 'PARTIALLY_REPAID' : 'ACTIVE';
        await record.save({ session });
      }
      repayment.isDeleted = true;
      await repayment.save({ session });
    }

    await RecurringOccurrenceModel.updateOne(
      { userId, transactionId: tx._id, status: 'PAID' },
      { $set: { status: 'PENDING', transactionId: null } },
      { session },
    );
    tx.isDeleted = true;
    await tx.save({ session });
    await recordTransactionActivity(userId, { action: 'DELETED', before: toTransactionDto(tx) }, session);
    await session.commitTransaction();
    return { deleted: true };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function getDailySummary(userId: string, date: string) {
  const from = startOfDayIST(date);
  const to = endOfDayIST(date);
  const txs = await TransactionModel.find({
    userId,
    isDeleted: false,
    transactionDate: { $gte: from, $lte: to },
  }).sort({ transactionDate: -1, createdAt: -1 });

  const totals = summarize(txs);
  return { date, transactions: txs.map(toTransactionDto), totals };
}

export async function getMonthlySummary(userId: string, year: number, month: number) {
  const from = parseDateInIST(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month').toDate();
  const to = parseDateInIST(`${year}-${String(month).padStart(2, '0')}-01`).endOf('month').toDate();
  const txs = await TransactionModel.find({
    userId,
    isDeleted: false,
    transactionDate: { $gte: from, $lte: to },
  });
  const totals = summarize(txs);
  const savingsPaise = subtractPaise(totals.incomePaise, totals.expensePaise);
  return {
    year,
    month,
    totals: {
      ...Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [
          k.replace('Paise', ''),
          typeof v === 'number' && k.endsWith('Paise') ? toRupees(v) : v,
        ]),
      ),
      savings: toRupees(savingsPaise),
      netCashMovement: toRupees(totals.netCashMovementPaise),
    },
    transactionCount: txs.length,
  };
}

function summarize(
  txs: Array<{ type: string; amountPaise: number }>,
) {
  const sums = {
    incomePaise: 0,
    expensePaise: 0,
    lendingPaise: 0,
    borrowingPaise: 0,
    lendingRepaymentPaise: 0,
    borrowingRepaymentPaise: 0,
    transferPaise: 0,
    refundPaise: 0,
    netCashMovementPaise: 0,
  };

  for (const tx of txs) {
    switch (tx.type) {
      case 'INCOME':
        sums.incomePaise = addPaise(sums.incomePaise, tx.amountPaise);
        sums.netCashMovementPaise = addPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'EXPENSE':
        sums.expensePaise = addPaise(sums.expensePaise, tx.amountPaise);
        sums.netCashMovementPaise = subtractPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'LENDING':
        sums.lendingPaise = addPaise(sums.lendingPaise, tx.amountPaise);
        sums.netCashMovementPaise = subtractPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'BORROWING':
        sums.borrowingPaise = addPaise(sums.borrowingPaise, tx.amountPaise);
        sums.netCashMovementPaise = addPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'LENDING_REPAYMENT':
        sums.lendingRepaymentPaise = addPaise(sums.lendingRepaymentPaise, tx.amountPaise);
        sums.netCashMovementPaise = addPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'BORROWING_REPAYMENT':
        sums.borrowingRepaymentPaise = addPaise(sums.borrowingRepaymentPaise, tx.amountPaise);
        sums.netCashMovementPaise = subtractPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      case 'TRANSFER':
        sums.transferPaise = addPaise(sums.transferPaise, tx.amountPaise);
        break;
      case 'REFUND':
        sums.refundPaise = addPaise(sums.refundPaise, tx.amountPaise);
        sums.expensePaise = subtractPaise(sums.expensePaise, tx.amountPaise);
        sums.netCashMovementPaise = addPaise(sums.netCashMovementPaise, tx.amountPaise);
        break;
      default:
        break;
    }
  }
  return sums;
}
