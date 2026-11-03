import type { ClientSession } from 'mongoose';
import {
  DEFAULT_BORROWING_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_LENDING_CATEGORIES,
  type CategoryType,
} from '../../shared/constants/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import { CategoryModel } from './category.model.js';

export async function seedDefaultCategories(userId: string, session?: ClientSession) {
  const uid = toObjectId(userId, 'userId');
  const docs = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, type: 'EXPENSE' as const })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ ...c, type: 'INCOME' as const })),
    ...DEFAULT_LENDING_CATEGORIES.map((c) => ({ ...c, type: 'LENDING' as const })),
    ...DEFAULT_BORROWING_CATEGORIES.map((c) => ({ ...c, type: 'BORROWING' as const })),
  ].map((c) => ({
    userId: uid,
    name: c.name,
    type: c.type,
    icon: c.icon,
    color: c.color,
    isDefault: true,
    isArchived: false,
  }));

  await CategoryModel.insertMany(docs, { session, ordered: true });
}

export const categoryService = {
  async list(userId: string, filters: { type?: CategoryType; includeArchived?: boolean }) {
    const query: Record<string, unknown> = { userId: toObjectId(userId, 'userId') };
    if (filters.type) query.type = filters.type;
    if (!filters.includeArchived) query.isArchived = false;
    const rows = await CategoryModel.find(query).sort({ type: 1, name: 1 }).lean();
    return rows.map((r) => serializeDoc(r));
  },

  async create(
    userId: string,
    input: { name: string; type: CategoryType; icon?: string; color?: string },
  ) {
    try {
      const created = await CategoryModel.create({
        userId: toObjectId(userId, 'userId'),
        name: input.name.trim(),
        type: input.type,
        icon: input.icon ?? 'circle',
        color: input.color ?? '#64748B',
        isDefault: false,
      });
      return serializeDoc(created);
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError('Category with this name and type already exists');
      }
      throw err;
    }
  },

  async update(
    userId: string,
    id: string,
    input: Partial<{ name: string; icon: string; color: string; isArchived: boolean }>,
  ) {
    const updated = await CategoryModel.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId, 'userId') },
      { $set: input },
      { new: true },
    );
    if (!updated) throw new NotFoundError('Category');
    return serializeDoc(updated);
  },

  async remove(userId: string, id: string) {
    const updated = await CategoryModel.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId, 'userId') },
      { $set: { isArchived: true } },
      { new: true },
    );
    if (!updated) throw new NotFoundError('Category');
    return serializeDoc(updated);
  },

  async getOwned(userId: string, id: string) {
    const cat = await CategoryModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
      isArchived: false,
    });
    if (!cat) throw new NotFoundError('Category');
    return cat;
  },
};
