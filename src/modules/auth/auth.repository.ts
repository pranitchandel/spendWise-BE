import type { ClientSession } from 'mongoose';
import { RefreshTokenModel, UserModel } from '../users/user.model.js';
import { toObjectId } from '../../shared/utils/mongo.js';

export const authRepository = {
  findUserByEmail(email: string, withPassword = false) {
    const q = UserModel.findOne({ email: email.toLowerCase() });
    if (withPassword) q.select('+passwordHash');
    return q;
  },

  findUserById(userId: string, withPassword = false) {
    const q = UserModel.findById(toObjectId(userId, 'userId'));
    if (withPassword) q.select('+passwordHash');
    return q;
  },

  createUser(
    data: { email: string; passwordHash: string; name: string },
    session?: ClientSession,
  ) {
    return UserModel.create([data], { session }).then((rows) => rows[0]!);
  },

  createRefreshToken(
    data: {
      userId: string;
      tokenHash: string;
      family: string;
      expiresAt: Date;
      userAgent?: string | null;
      ip?: string | null;
    },
    session?: ClientSession,
  ) {
    return RefreshTokenModel.create(
      [
        {
          userId: toObjectId(data.userId, 'userId'),
          tokenHash: data.tokenHash,
          family: data.family,
          expiresAt: data.expiresAt,
          userAgent: data.userAgent ?? null,
          ip: data.ip ?? null,
        },
      ],
      { session },
    ).then((rows) => rows[0]!);
  },

  findRefreshByHash(tokenHash: string) {
    return RefreshTokenModel.findOne({ tokenHash });
  },

  revokeFamily(family: string, session?: ClientSession) {
    return RefreshTokenModel.updateMany(
      { family, revokedAt: null },
      { revokedAt: new Date() },
      { session },
    );
  },

  revokeToken(tokenHash: string, replacedByTokenHash?: string) {
    return RefreshTokenModel.updateOne(
      { tokenHash },
      {
        revokedAt: new Date(),
        ...(replacedByTokenHash ? { replacedByTokenHash } : {}),
      },
    );
  },
};
