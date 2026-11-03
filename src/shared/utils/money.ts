import { Decimal } from 'decimal.js';
import { PAISE_PER_RUPEE } from '../constants/index.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Convert rupees (number or string) to integer paise. Never use float math for money. */
export function toPaise(rupees: number | string): number {
  const value = new Decimal(rupees).mul(PAISE_PER_RUPEE);
  if (!value.isInteger()) {
    // Round half-up to nearest paise
    return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
  return value.toNumber();
}

/** Convert integer paise to rupees number for API responses. */
export function toRupees(paise: number): number {
  return new Decimal(paise).div(PAISE_PER_RUPEE).toDecimalPlaces(2).toNumber();
}

/** Format paise as INR display string. */
export function formatINR(paise: number): string {
  const rupees = toRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function addPaise(...amounts: number[]): number {
  return amounts.reduce((sum, a) => new Decimal(sum).plus(a).toNumber(), 0);
}

export function subtractPaise(a: number, b: number): number {
  return new Decimal(a).minus(b).toNumber();
}

export function absPaise(a: number): number {
  return Math.abs(a);
}

export function isPositivePaise(a: number): boolean {
  return a > 0;
}

export function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return new Decimal(part).div(whole).mul(100).toDecimalPlaces(2).toNumber();
}
