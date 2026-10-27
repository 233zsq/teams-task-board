import type { TaskStatus } from '../contracts/types';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month; `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

/**
 * Pure string validation. Never calls `Date` on the date string: `Date`
 * mis-handles years 0001–0099 and local/UTC midnight offsets (D-20).
 */
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || year > 9999) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  return true;
}

/** Lexicographic comparison is chronological for zero-padded `YYYY-MM-DD`. */
export function compareDateStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Current business date (Asia/Shanghai) as `YYYY-MM-DD`. */
export function businessToday(now: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Overdue: dated, strictly before today, and not done (spec §4.3). */
export function isOverdue(
  dueDate: string | null,
  status: TaskStatus,
  today: string,
): boolean {
  return dueDate !== null && dueDate < today && status !== 'done';
}

/** Format a UTC timestamp as `YYYY-MM-DD HH:mm` in the business time zone. */
export function formatBusinessDateTime(
  iso: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Format an instant as `HH:mm:ss` in the business time zone. */
export function formatBusinessTime(
  instant: Date | number,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')}:${pick('second')}`;
}