import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModel } from '../../src/modules/accounts/account.model.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { TransactionModel } from '../../src/modules/transactions/transaction.model.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await AccountModel.init();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await AccountModel.deleteMany({});
  userId = new Types.ObjectId();
});

describe('account CRUD', () => {
  it('updates account details, opening balance, account type, and currency', async () => {
    const created = await accountService.create(userId.toString(), {
      name: 'Daily cash',
      type: 'CASH',
      openingBalance: 100,
      openingBalanceDate: '2026-11-01',
    });

    const updated = await accountService.update(userId.toString(), String(created.id), {
      name: 'Wallet',
      type: 'SAVINGS',
      institutionName: 'Local bank',
      maskedIdentifier: '1234',
      openingBalance: 250,
      openingBalanceDate: '2026-11-02',
      currency: 'inr',
    });

    expect(updated).toMatchObject({
      name: 'Wallet',
      type: 'SAVINGS',
      institutionName: 'Local bank',
      maskedIdentifier: '1234',
      openingBalance: 250,
      balance: 250,
      currency: 'INR',
    });
  });

  it('archives accounts instead of removing ledger history and supports restoring them', async () => {
    const account = await accountService.create(userId.toString(), {
      name: 'Spare wallet',
      type: 'CASH',
      openingBalance: 0,
      openingBalanceDate: '2026-11-01',
    });

    await accountService.remove(userId.toString(), String(account.id));
    expect(await accountService.list(userId.toString())).toHaveLength(0);
    expect(await accountService.list(userId.toString(), true)).toHaveLength(1);

    const restored = await accountService.update(userId.toString(), String(account.id), {
      isArchived: false,
      isActive: true,
    });
    expect(restored).toMatchObject({ isArchived: false, isActive: true });
  });

  it('permanently deletes an account with no linked records', async () => {
    const account = await accountService.create(userId.toString(), {
      name: 'Unused wallet',
      type: 'CASH',
      openingBalance: 0,
      openingBalanceDate: '2026-11-01',
    });

    const result = await accountService.permanentlyDelete(userId.toString(), String(account.id));

    expect(result).toEqual({ id: String(account.id) });
    expect(await AccountModel.findById(account.id)).toBeNull();
  });

  it('prevents permanent deletion when transactions reference the account', async () => {
    const account = await accountService.create(userId.toString(), {
      name: 'Used wallet',
      type: 'CASH',
      openingBalance: 0,
      openingBalanceDate: '2026-11-01',
    });
    await TransactionModel.create({
      userId,
      amountPaise: 100,
      transactionDate: new Date('2026-11-02T00:00:00.000Z'),
      type: 'EXPENSE',
      categoryId: new Types.ObjectId(),
      paymentMode: 'CASH',
      accountId: new Types.ObjectId(String(account.id)),
    });

    await expect(accountService.permanentlyDelete(userId.toString(), String(account.id)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await AccountModel.findById(account.id)).not.toBeNull();
  });
});
