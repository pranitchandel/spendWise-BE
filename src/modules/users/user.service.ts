import { ConflictError, NotFoundError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import type { ChangePasswordInput, UpdateProfileInput } from './user.types.js';
import { RefreshTokenModel, UserModel } from './user.model.js';

export const userService = {
  async getMe(userId: string) {
    const user = await UserModel.findById(toObjectId(userId, 'userId')).lean();
    if (!user) throw new NotFoundError('User');
    return serializeDoc(user);
  },

  async updateMe(userId: string, input: UpdateProfileInput) {
    const id = toObjectId(userId, 'userId');
    if (input.email) {
      const existing = await UserModel.findOne({ email: input.email, _id: { $ne: id } }).select('_id').lean();
      if (existing) throw new ConflictError('Email already registered');
    }
    try {
      const user = await UserModel.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean();
      if (!user) throw new NotFoundError('User');
      return serializeDoc(user);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictError('Email already registered');
      throw error;
    }
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const id = toObjectId(userId, 'userId');
    const user = await UserModel.findById(id).select('+passwordHash');
    if (!user) throw new NotFoundError('User');
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    user.passwordHash = await hashPassword(input.newPassword);
    await user.save();
    await RefreshTokenModel.updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return { message: 'Password updated. Sign in again to continue.' };
  },
};
