import { toRupees } from './money.js';

type SerializableDoc = {
  _id?: { toString(): string };
  toObject?: (opts?: object) => Record<string, unknown>;
};

function idOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value);
}

const REF_KEYS = [
  'userId',
  'categoryId',
  'accountId',
  'toAccountId',
  'personId',
  'linkedRecordId',
  'linkedTransactionId',
  'transactionId',
  'recordId',
  'ruleId',
] as const;

export function serializeDoc(value: object): Record<string, unknown> {
  const doc = value as SerializableDoc;
  const raw =
    typeof doc.toObject === 'function'
      ? doc.toObject({ virtuals: false })
      : (doc as Record<string, unknown>);
  const out: Record<string, unknown> = { ...raw };

  if (raw._id) out.id = idOf(raw._id);
  delete out._id;
  delete out.__v;

  if (typeof raw.amountPaise === 'number') out.amount = toRupees(raw.amountPaise as number);
  if (typeof raw.openingBalancePaise === 'number') {
    out.openingBalance = toRupees(raw.openingBalancePaise as number);
  }
  if (typeof raw.principalPaise === 'number') {
    out.principal = toRupees(raw.principalPaise as number);
  }
  if (typeof raw.outstandingPaise === 'number') {
    out.outstanding = toRupees(raw.outstandingPaise as number);
  }
  if (typeof raw.repaidPaise === 'number') out.repaid = toRupees(raw.repaidPaise as number);
  if (typeof raw.interestPaise === 'number') {
    out.interest = toRupees(raw.interestPaise as number);
  }
  if (typeof raw.limitPaise === 'number') out.limit = toRupees(raw.limitPaise as number);
  if (typeof raw.spentPaise === 'number') out.spent = toRupees(raw.spentPaise as number);

  for (const key of REF_KEYS) {
    if (key in out) out[key] = idOf(out[key]);
  }

  return out;
}

export function paiseTotalsToRupees(totals: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(totals)) {
    result[key] = toRupees(value);
  }
  return result;
}
