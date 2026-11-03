import dayjs from 'dayjs';
import { ConflictError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { env } from '../../config/env.js';
import { withTransaction } from '../../shared/utils/mongo.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import {
  createTokenFamily,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../shared/utils/tokens.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import { seedDefaultCategories } from '../categories/category.service.js';
import { authRepository } from './auth.repository.js';
import type { LoginInput, RegisterInput } from './auth.types.js';

function refreshExpiryDate(): Date {
  // Parse JWT_REFRESH_EXPIRES_IN like 7d / 15m
  const raw = env.JWT_REFRESH_EXPIRES_IN;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return dayjs().add(7, 'day').toDate();
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const map = { s: 'second', m: 'minute', h: 'hour', d: 'day' } as const;
  return dayjs().add(amount, map[unit]).toDate();
}

function publicUser(user: { _id: { toString(): string }; email: string; name: string; preferredCurrency?: string; timezone?: string; theme?: string }) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    preferredCurrency: user.preferredCurrency ?? 'INR',
    timezone: user.timezone ?? 'Asia/Kolkata',
    theme: user.theme ?? 'system',
  };
}

async function issueTokens(
  userId: string,
  email: string,
  opts: { family?: string; userAgent?: string | null; ip?: string | null } = {},
) {
  const family = opts.family ?? createTokenFamily();
  const accessToken = signAccessToken(userId, email);
  const refreshToken = signRefreshToken(userId, email, family);
  const tokenHash = sha256(refreshToken);
  await authRepository.createRefreshToken({
    userId,
    tokenHash,
    family,
    expiresAt: refreshExpiryDate(),
    userAgent: opts.userAgent,
    ip: opts.ip,
  });
  return { accessToken, refreshToken, family };
}

export const authService = {
  async register(
    input: RegisterInput,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ) {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) throw new ConflictError('Email already registered');

    const passwordHash = await hashPassword(input.password);

    const result = await withTransaction(async (session) => {
      const user = await authRepository.createUser(
        {
          email: input.email,
          passwordHash,
          name: input.name,
        },
        session,
      );
      await seedDefaultCategories(user._id.toString(), session);
      return user;
    });

    const tokens = await issueTokens(result._id.toString(), result.email, meta);
    return {
      user: publicUser(result),
      ...tokens,
    };
  },

  async login(input: LoginInput, meta: { userAgent?: string | null; ip?: string | null } = {}) {
    const user = await authRepository.findUserByEmail(input.email, true);
    if (!user) throw new UnauthorizedError('Invalid email or password');
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedError('Invalid email or password');

    const tokens = await issueTokens(user._id.toString(), user.email, meta);
    return { user: publicUser(user), ...tokens };
  },

  async refresh(
    refreshToken: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const tokenHash = sha256(refreshToken);
    const stored = await authRepository.findRefreshByHash(tokenHash);

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      // Possible reuse — revoke entire family if we can identify it
      if (payload.family) {
        await authRepository.revokeFamily(payload.family);
      }
      throw new UnauthorizedError('Refresh token revoked or expired');
    }

    if (stored.userId.toString() !== payload.userId) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const newAccess = signAccessToken(payload.userId, payload.email);
    const newRefresh = signRefreshToken(payload.userId, payload.email, payload.family);
    const newHash = sha256(newRefresh);

    await authRepository.revokeToken(tokenHash, newHash);
    await authRepository.createRefreshToken({
      userId: payload.userId,
      tokenHash: newHash,
      family: payload.family,
      expiresAt: refreshExpiryDate(),
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    const user = await authRepository.findUserById(payload.userId);
    if (!user) throw new UnauthorizedError('User not found');

    return {
      user: publicUser(user),
      accessToken: newAccess,
      refreshToken: newRefresh,
    };
  },

  async logout(refreshToken?: string) {
    if (!refreshToken) return;
    try {
      const payload = verifyRefreshToken(refreshToken);
      await authRepository.revokeFamily(payload.family);
    } catch {
      const tokenHash = sha256(refreshToken);
      await authRepository.revokeToken(tokenHash);
    }
  },

  serializeUser(user: Parameters<typeof serializeDoc>[0]) {
    return serializeDoc(user);
  },
};
