import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { BorrowingRecordModel } from '../../src/modules/borrowing/borrowing.model.js';
import { CategoryModel } from '../../src/modules/categories/category.model.js';
import { LendingRecordModel } from '../../src/modules/lending/lending.model.js';
import { addRepayment as addLendingRepayment, createLending, deleteLending, getLending, listLending, updateLending } from '../../src/modules/lending/lending.service.js';
import { addRepayment as addBorrowingRepayment, deleteBorrowing, getBorrowing, listBorrowing, updateBorrowing } from '../../src/modules/borrowing/borrowing.service.js';
import { PersonModel } from '../../src/modules/people/person.model.js';
import { RepaymentModel } from '../../src/modules/repayments/repayment.model.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';
import { createTransaction } from '../../src/modules/transactions/transaction.service.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let accountId: string;
let lendingCategoryId: string;
let borrowingCategoryId: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([
    AccountModel.init(),
    BorrowingRecordModel.init(),
    CategoryModel.init(),
    LendingRecordModel.init(),
    PersonModel.init(),
    RepaymentModel.init(),
    TransactionModel.init(),
  ]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    BorrowingRecordModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    LendingRecordModel.deleteMany({}),
    PersonModel.deleteMany({}),
    RepaymentModel.deleteMany({}),
    TransactionModel.deleteMany({}),
  ]);
  userId = new Types.ObjectId();
  const [lendingCategory, borrowingCategory] = await CategoryModel.create([
    { userId, name: 'Money lent', type: 'LENDING' },
    { userId, name: 'Money borrowed', type: 'BORROWING' },
  ]);
  const account = await AccountModel.create({
    userId,
    name: 'Main account',
    type: 'SAVINGS',
    openingBalancePaise: 100_000,
    openingBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
  });
  lendingCategoryId = lendingCategory._id.toString();
  borrowingCategoryId = borrowingCategory._id.toString();
  accountId = account._id.toString();
});

describe('lending and borrowing CRUD', () => {
  it('returns active lending and borrowing records when status is ALL', async () => {
    const user = userId.toString();
    const lending = await createLending(user, {
      type: 'LENDING',
      personName: 'Alex',
      amount: 1_000,
      transactionDate: '2026-11-01',
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'CASH',
    });
    await createTransaction(user, {
      type: 'BORROWING',
      personName: 'Jordan',
      amount: 1_000,
      transactionDate: '2026-11-01',
      accountId,
      categoryId: borrowingCategoryId,
      paymentMode: 'CASH',
    });

    const lendingPage = await listLending(user, { status: 'ALL', page: 1, limit: 20 });
    const borrowingPage = await listBorrowing(user, { status: 'ALL', page: 1, limit: 20 });

    expect(lendingPage.items).toHaveLength(1);
    expect(lendingPage.items[0]).toMatchObject({ id: lending.linkedRecordId, status: 'ACTIVE' });
    expect(lendingPage.totalOutstanding).toBe(1_000);
    expect(borrowingPage.items).toHaveLength(1);
    expect(borrowingPage.items[0].status).toBe('ACTIVE');
    expect(borrowingPage.totalOutstanding).toBe(1_000);
  });

  it('updates all lending details through its linked transaction and deletes both when unpaid', async () => {
    const user = userId.toString();
    const created = await createLending(user, {
      type: 'LENDING',
      personName: 'Alex',
      phone: '1111111111',
      email: 'alex@example.com',
      amount: 1_000,
      transactionDate: '2026-11-01',
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'CASH',
      expectedRepaymentDate: '2026-12-01',
      interestRate: 2,
      description: 'Short-term loan',
      note: 'Original note',
    });
    const detail = await getLending(user, created.linkedRecordId!);
    expect(detail).toMatchObject({ categoryId: lendingCategoryId, paymentMode: 'CASH' });

    const updated = await updateLending(user, detail.id, {
      personName: 'Alex Rivera',
      phone: '2222222222',
      email: 'alex.rivera@example.com',
      amount: 1_200,
      transactionDate: '2026-11-02',
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'UPI',
      expectedRepaymentDate: '2027-01-01',
      interestRate: 3.5,
      description: 'Updated loan',
      notes: 'Updated note',
    });
    expect(updated).toMatchObject({
      personName: 'Alex Rivera',
      phone: '2222222222',
      email: 'alex.rivera@example.com',
      originalAmount: 1_200,
      outstanding: 1_200,
      lendingDate: '2026-11-02',
      expectedRepaymentDate: '2027-01-01',
      interestRate: 3.5,
      description: 'Updated loan',
      notes: 'Updated note',
    });
    const sourceTransaction = await TransactionModel.findById(detail.linkedTransactionId);
    expect(sourceTransaction).toMatchObject({ amountPaise: 120_000, paymentMode: 'UPI' });

    await expect(deleteLending(user, detail.id)).resolves.toEqual({ deleted: true });
    expect(await LendingRecordModel.findById(detail.id)).toMatchObject({ isDeleted: true });
    expect(await TransactionModel.findById(detail.linkedTransactionId)).toMatchObject({ isDeleted: true });
  });

  it('protects repaid lending and borrowing history from parent deletion', async () => {
    const user = userId.toString();
    const lending = await createLending(user, {
      type: 'LENDING',
      personName: 'Taylor',
      amount: 1_000,
      transactionDate: '2026-11-01',
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'CASH',
    });
    const lendingRecord = await getLending(user, lending.linkedRecordId!);
    await addLendingRepayment(user, lendingRecord.id, {
      amount: 300,
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'CASH',
      transactionDate: '2026-11-03',
    });
    await expect(deleteLending(user, lendingRecord.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateLending(user, lendingRecord.id, {
      personName: 'Taylor',
      amount: 1_200,
      transactionDate: '2026-11-05',
      accountId,
      categoryId: lendingCategoryId,
      paymentMode: 'UPI',
    })).rejects.toMatchObject({ statusCode: 409, message: 'Lending records with repayment history cannot be edited.' });

    const borrowing = await createTransaction(user, {
      type: 'BORROWING',
      personName: 'Jordan',
      amount: 1_000,
      transactionDate: '2026-11-01',
      accountId,
      categoryId: borrowingCategoryId,
      paymentMode: 'CASH',
      repaymentTerms: 'Monthly installments',
    });
    const borrowingRecord = await getBorrowing(user, borrowing.linkedRecordId!);
    const editedBorrowing = await updateBorrowing(user, borrowingRecord.id, {
      personName: 'Jordan Lee',
      amount: 1_100,
      transactionDate: '2026-11-02',
      accountId,
      categoryId: borrowingCategoryId,
      paymentMode: 'UPI',
      repaymentTerms: 'Quarterly installments',
      notes: 'Revised agreement',
    });
    expect(editedBorrowing).toMatchObject({
      lenderName: 'Jordan Lee',
      originalAmount: 1_100,
      repaymentTerms: 'Quarterly installments',
      notes: 'Revised agreement',
    });
    await addBorrowingRepayment(user, borrowingRecord.id, {
      amount: 250,
      accountId,
      categoryId: borrowingCategoryId,
      paymentMode: 'CASH',
      transactionDate: '2026-11-04',
    });
    await expect(deleteBorrowing(user, borrowingRecord.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateBorrowing(user, borrowingRecord.id, {
      personName: 'Jordan Lee',
      amount: 1_100,
      transactionDate: '2026-11-02',
      accountId,
      categoryId: borrowingCategoryId,
      paymentMode: 'UPI',
      repaymentTerms: 'Updated terms',
    })).rejects.toMatchObject({ statusCode: 409, message: 'Borrowing records with repayment history cannot be edited.' });
  });
});