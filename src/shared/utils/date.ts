import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { TIMEZONE } from '../constants/index.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export function nowInIST() {
  return dayjs().tz(TIMEZONE);
}

export function toIST(date: Date | string | dayjs.Dayjs) {
  return dayjs(date).tz(TIMEZONE);
}

export function startOfDayIST(date?: Date | string) {
  return (date ? toIST(date) : nowInIST()).startOf('day').toDate();
}

export function endOfDayIST(date?: Date | string) {
  return (date ? toIST(date) : nowInIST()).endOf('day').toDate();
}

export function startOfMonthIST(year: number, month: number) {
  return dayjs.tz(`${year}-${String(month).padStart(2, '0')}-01`, TIMEZONE).startOf('month').toDate();
}

export function endOfMonthIST(year: number, month: number) {
  return dayjs.tz(`${year}-${String(month).padStart(2, '0')}-01`, TIMEZONE).endOf('month').toDate();
}

export function parseDateInIST(dateStr: string) {
  return dayjs.tz(dateStr, TIMEZONE);
}

export function formatDateIST(date: Date | string, format = 'YYYY-MM-DD') {
  return toIST(date).format(format);
}

export function getYearMonthIST(date?: Date | string) {
  const d = date ? toIST(date) : nowInIST();
  return { year: d.year(), month: d.month() + 1 };
}
