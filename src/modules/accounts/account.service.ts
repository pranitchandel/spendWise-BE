import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { parseDateInIST, startOfDayIST } from '../../shared/utils/date.js';
import { toPaise, toRupees } from '../../shared/utils/money.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { buildPaginationMeta, normalizePagination } from '../../shared/utils/pagination.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import { BorrowingRecordModel } from '../borrowing/borrowing.model.js';
import { LendingRecordModel } from '../lending/lending.model.js';
import { RepaymentModel } from '../repayments/repayment.model.js';
import { RecurringRuleModel } from '../recurring/recurring.model.js';
import { computeBalanceFromMovements } from '../transactions/ledger.js';
import { TransactionModel } from '../transactions/transaction.model.js';
import { AccountModel } from './account.model.js';
import type { CreateAccountInput } from './account.types.js';

export const accountService = {
  async list(userId: string, includeArchived = false) {
    const query: Record<string, unknown> = { userId: toObjectId(userId, 'userId') };
    if (!includeArchived) query.isArchived = false;
    const accounts = await AccountModel.find(query).sort({ name: 1 }).lean();
    const withBalances = await Promise.all(
      accounts.map(async (a) => {
        const balancePaise = await this.getBalancePaise(userId, a._id.toString());
        return { ...serializeDoc(a), balance: toRupees(balancePaise), balancePaise };
      }),
    );
    return withBalances;
  },

  async create(userId: string, input: CreateAccountInput) {
    try {
      const opening = toPaise(input.openingBalance ?? 0);
      const created = await AccountModel.create({
        userId: toObjectId(userId, 'userId'),
        name: input.name.trim(),
        type: input.type,
        institutionName: input.institutionName ?? '',
        maskedIdentifier: input.maskedIdentifier ?? '',
        openingBalancePaise: opening,
        openingBalanceDate: input.openingBalanceDate
          ? startOfDayIST(input.openingBalanceDate)
          : startOfDayIST(),
        currency: input.currency ?? 'INR',
      });
      return {
        ...serializeDoc(created),
        balance: toRupees(opening),
        balancePaise: opening,
      };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError('Account with this name already exists');
      }
      throw err;
    }
  },

  async getById(userId: string, id: string) {
    const account = await AccountModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
    }).lean();
    if (!account) throw new NotFoundError('Account');
    const balancePaise = await this.getBalancePaise(userId, id);
    return { ...serializeDoc(account), balance: toRupees(balancePaise), balancePaise };
  },

  async update(
    userId: string,
    id: string,
    input: Partial<{
      name: string;
      type: CreateAccountInput['type'];
      institutionName: string;
      maskedIdentifier: string;
      openingBalance: number | string;
      openingBalanceDate: string;
      currency: string;
      isActive: boolean;
      isArchived: boolean;
    }>,
  ) {
    const account = await AccountModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
    });
    if (!account) throw new NotFoundError('Account');

    if (input.name !== undefined) account.name = input.name.trim();
    if (input.type !== undefined) account.type = input.type;
    if (input.institutionName !== undefined) account.institutionName = input.institutionName;
    if (input.maskedIdentifier !== undefined) account.maskedIdentifier = input.maskedIdentifier;
    if (input.openingBalance !== undefined) account.openingBalancePaise = toPaise(input.openingBalance);
    if (input.openingBalanceDate !== undefined) account.openingBalanceDate = startOfDayIST(input.openingBalanceDate);
    if (input.currency !== undefined) account.currency = input.currency.toUpperCase();
    if (input.isActive !== undefined) account.isActive = input.isActive;
    if (input.isArchived !== undefined) account.isArchived = input.isArchived;
    let updated;
    try {
      updated = await account.save();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictError('Account with this name already exists');
      }
      throw error;
    }
    const balancePaise = await this.getBalancePaise(userId, id);
    return { ...serializeDoc(updated), balance: toRupees(balancePaise), balancePaise };
  },

  async remove(userId: string, id: string) {
    return this.update(userId, id, { isArchived: true, isActive: false });
  },

  async permanentlyDelete(userId: string, id: string) {
    const ownerId = toObjectId(userId, 'userId');
    const accountId = toObjectId(id);
    const account = await AccountModel.findOne({ _id: accountId, userId: ownerId }).lean();
    if (!account) throw new NotFoundError('Account');

    const references = await Promise.all([
      TransactionModel.countDocuments({
        userId: ownerId,
        $or: [{ accountId }, { toAccountId: accountId }],
      }),
      RecurringRuleModel.countDocuments({
        userId: ownerId,
        $or: [{ accountId }, { toAccountId: accountId }],
      }),
      LendingRecordModel.countDocuments({ userId: ownerId, sourceAccountId: accountId }),
      BorrowingRecordModel.countDocuments({ userId: ownerId, receivingAccountId: accountId }),
      RepaymentModel.countDocuments({ userId: ownerId, accountId }),
    ]);

    if (references.some((count) => count > 0)) {
      throw new ConflictError('This account has linked financial history or schedules. Archive it instead.');
    }

    await AccountModel.deleteOne({ _id: accountId, userId: ownerId });
    return { id };
  },

  async getOwned(userId: string, id: string) {
    const account = await AccountModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
      isArchived: false,
    });
    if (!account) throw new NotFoundError('Account');
    return account;
  },

  async getBalancePaise(userId: string, accountId: string): Promise<number> {
    const account = await AccountModel.findOne({
      _id: toObjectId(accountId),
      userId: toObjectId(userId, 'userId'),
    }).lean();
    if (!account) throw new NotFoundError('Account');

    const movements = await TransactionModel.find({
      userId: toObjectId(userId, 'userId'),
      isDeleted: false,
      $or: [{ accountId: account._id }, { toAccountId: account._id }],
    })
      .select('type amountPaise accountId toAccountId')
      .lean();

    return computeBalanceFromMovements(
      account.openingBalancePaise,
      movements.map((m) => ({
        transactionType: m.type,
        amountPaise: m.amountPaise,
        accountId: String(m.accountId),
        toAccountId: m.toAccountId ? String(m.toAccountId) : null,
      })),
      accountId,
    );
  },

  async getBalance(userId: string, accountId: string) {
    const balancePaise = await this.getBalancePaise(userId, accountId);
    return { accountId, balance: toRupees(balancePaise), balancePaise };
  },

  async listTransactions(
    userId: string,
    accountId: string,
    query: { page?: number; limit?: number; from?: string; to?: string },
  ) {
    await this.getOwned(userId, accountId);
    const { page, limit, skip } = normalizePagination(query);
    const filter: Record<string, unknown> = {
      userId: toObjectId(userId, 'userId'),
      isDeleted: false,
      $or: [{ accountId: toObjectId(accountId) }, { toAccountId: toObjectId(accountId) }],
    };
    if (query.from || query.to) {
      filter.transactionDate = {};
      if (query.from) {
        (filter.transactionDate as Record<string, Date>).$gte = parseDateInIST(query.from)
          .startOf('day')
          .toDate();
      }
      if (query.to) {
        (filter.transactionDate as Record<string, Date>).$lte = parseDateInIST(query.to)
          .endOf('day')
          .toDate();
      }
    }

    const [total, rows] = await Promise.all([
      TransactionModel.countDocuments(filter),
      TransactionModel.find(filter).sort({ transactionDate: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return {
      items: rows.map((r) => serializeDoc(r)),
      meta: buildPaginationMeta(total, page, limit),
    };
  },
};
