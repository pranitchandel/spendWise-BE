import { NotFoundError } from '../../shared/errors/AppError.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import type { UpdateProfileInput } from './user.types.js';
import { UserModel } from './user.model.js';

export const userService = {
  async getMe(userId: string) {
    const user = await UserModel.findById(toObjectId(userId, 'userId')).lean();
    if (!user) throw new NotFoundError('User');
    return serializeDoc(user);
  },

  async updateMe(userId: string, input: UpdateProfileInput) {
    const user = await UserModel.findByIdAndUpdate(
      toObjectId(userId, 'userId'),
      { $set: input },
      { new: true },
    ).lean();
    if (!user) throw new NotFoundError('User');
    return serializeDoc(user);
  },
};
