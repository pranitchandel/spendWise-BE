import { NotFoundError } from '../../shared/errors/AppError.js';
import { toObjectId } from '../../shared/utils/mongo.js';
import { buildPaginationMeta, normalizePagination } from '../../shared/utils/pagination.js';
import { serializeDoc } from '../../shared/utils/serializers.js';
import { PersonModel } from './person.model.js';

export const personService = {
  async list(
    userId: string,
    query: { page?: number; limit?: number; q?: string; includeArchived?: boolean },
  ) {
    const { page, limit, skip } = normalizePagination(query);
    const filter: Record<string, unknown> = { userId: toObjectId(userId, 'userId') };
    if (!query.includeArchived) filter.isArchived = false;
    if (query.q) filter.name = { $regex: query.q, $options: 'i' };

    const [total, rows] = await Promise.all([
      PersonModel.countDocuments(filter),
      PersonModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    ]);

    return {
      items: rows.map((r) => serializeDoc(r)),
      meta: buildPaginationMeta(total, page, limit),
    };
  },

  async create(
    userId: string,
    input: { name: string; phone?: string; email?: string; notes?: string },
  ) {
    const created = await PersonModel.create({
      userId: toObjectId(userId, 'userId'),
      name: input.name.trim(),
      phone: input.phone ?? '',
      email: input.email ?? '',
      notes: input.notes ?? '',
    });
    return serializeDoc(created);
  },

  async getById(userId: string, id: string) {
    const person = await PersonModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
    }).lean();
    if (!person) throw new NotFoundError('Person');
    return serializeDoc(person);
  },

  async update(
    userId: string,
    id: string,
    input: Partial<{
      name: string;
      phone: string;
      email: string;
      notes: string;
      isArchived: boolean;
    }>,
  ) {
    const updated = await PersonModel.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId, 'userId') },
      { $set: input },
      { new: true },
    );
    if (!updated) throw new NotFoundError('Person');
    return serializeDoc(updated);
  },

  async remove(userId: string, id: string) {
    return this.update(userId, id, { isArchived: true });
  },

  async getOwned(userId: string, id: string) {
    const person = await PersonModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId, 'userId'),
      isArchived: false,
    });
    if (!person) throw new NotFoundError('Person');
    return person;
  },
};
