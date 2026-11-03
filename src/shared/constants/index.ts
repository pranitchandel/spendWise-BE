export const TIMEZONE = 'Asia/Kolkata';
export const CURRENCY = 'INR';
export const PAISE_PER_RUPEE = 100;

export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'LENDING',
  'BORROWING',
  'LENDING_REPAYMENT',
  'BORROWING_REPAYMENT',
  'TRANSFER',
  'REFUND',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_MODES = [
  'UPI',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'CASH',
  'BANK_TRANSFER',
  'NET_BANKING',
  'OTHER',
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const ACCOUNT_TYPES = [
  'SAVINGS',
  'CURRENT',
  'CASH',
  'CREDIT_CARD',
  'OTHER',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_TYPES = [
  'EXPENSE',
  'INCOME',
  'LENDING',
  'BORROWING',
  'TRANSFER',
  'REFUND',
] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const LENDING_STATUSES = [
  'ACTIVE',
  'PARTIALLY_REPAID',
  'REPAID',
  'OVERDUE',
  'WRITTEN_OFF',
] as const;

export type LendingStatus = (typeof LENDING_STATUSES)[number];

export const BORROWING_STATUSES = [
  'ACTIVE',
  'PARTIALLY_REPAID',
  'REPAID',
  'OVERDUE',
  'WRITTEN_OFF',
] as const;

export type BorrowingStatus = (typeof BORROWING_STATUSES)[number];

export const RECURRING_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'YEARLY',
] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const OCCURRENCE_STATUSES = ['PENDING', 'PAID', 'SKIPPED', 'POSTPONED'] as const;

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const BUDGET_THRESHOLDS = {
  NORMAL: 75,
  WARNING: 90,
  HIGH: 100,
} as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Groceries & household', icon: 'shopping-cart', color: '#16A34A' },
  { name: 'Food & eating out', icon: 'utensils', color: '#EA580C' },
  { name: 'Fuel', icon: 'fuel', color: '#DC2626' },
  { name: 'Medical & pharmacy', icon: 'heart-pulse', color: '#E11D48' },
  { name: 'Mobile & internet', icon: 'smartphone', color: '#2563EB' },
  { name: 'Subscriptions', icon: 'repeat', color: '#7C3AED' },
  { name: 'Shopping & personal', icon: 'shopping-bag', color: '#DB2777' },
  { name: 'Family & social', icon: 'users', color: '#0891B2' },
  { name: 'Travel', icon: 'plane', color: '#0D9488' },
  { name: 'Entertainment', icon: 'clapperboard', color: '#9333EA' },
  { name: 'Education', icon: 'graduation-cap', color: '#4F46E5' },
  { name: 'Personal care', icon: 'sparkles', color: '#F59E0B' },
  { name: 'Other', icon: 'circle', color: '#64748B' },
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salary', icon: 'banknote', color: '#16A34A' },
  { name: 'Freelance', icon: 'briefcase', color: '#2563EB' },
  { name: 'Interest', icon: 'percent', color: '#0D9488' },
  { name: 'Investment income', icon: 'trending-up', color: '#7C3AED' },
  { name: 'Refund', icon: 'rotate-ccw', color: '#0891B2' },
  { name: 'Other income', icon: 'wallet', color: '#64748B' },
] as const;

export const DEFAULT_LENDING_CATEGORIES = [
  { name: 'Personal lending', icon: 'hand-coins', color: '#F59E0B' },
] as const;

export const DEFAULT_BORROWING_CATEGORIES = [
  { name: 'Personal borrowing', icon: 'landmark', color: '#DC2626' },
] as const;
