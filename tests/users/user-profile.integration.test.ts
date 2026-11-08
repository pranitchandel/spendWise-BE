import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RefreshTokenModel, UserModel } from '../../src/modules/users/user.model.js';
import { userService } from '../../src/modules/users/user.service.js';
import { hashPassword, verifyPassword } from '../../src/shared/utils/password.js';

let replicaSet: MongoMemoryReplSet;
let userId: Types.ObjectId;
let passwordHash: string;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  await UserModel.init();
  await RefreshTokenModel.init();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  userId = new Types.ObjectId();
  passwordHash = await hashPassword('initial-password');
  await UserModel.create({ _id: userId, email: 'old@example.com', name: 'Sample User', passwordHash });
});

describe('user profile updates', () => {
  it('updates the signup email and name without exposing the password hash', async () => {
    const updated = await userService.updateMe(userId.toString(), {
      email: 'new@example.com',
      name: 'Updated User',
    });

    expect(updated).toMatchObject({ email: 'new@example.com', name: 'Updated User' });
    expect(updated).not.toHaveProperty('passwordHash');
  });

  it('rejects an email already used by another account', async () => {
    await UserModel.create({ email: 'taken@example.com', name: 'Other User', passwordHash });
    await expect(userService.updateMe(userId.toString(), { email: 'taken@example.com' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires the current password, hashes the new one, and revokes refresh sessions', async () => {
    await RefreshTokenModel.create({
      userId,
      tokenHash: 'refresh-hash',
      family: 'test-family',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(userService.changePassword(userId.toString(), {
      currentPassword: 'wrong-password', newPassword: 'replacement-password',
    })).rejects.toMatchObject({ statusCode: 401 });

    await userService.changePassword(userId.toString(), {
      currentPassword: 'initial-password', newPassword: 'replacement-password',
    });
    const updated = await UserModel.findById(userId).select('+passwordHash');
    const refreshToken = await RefreshTokenModel.findOne({ userId });

    expect(await verifyPassword(updated!.passwordHash, 'replacement-password')).toBe(true);
    expect(refreshToken?.revokedAt).toBeInstanceOf(Date);
  });
});