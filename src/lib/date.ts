/**
 * 时间处理：内容统一以 UTC 保存，展示时固定换算到北京时区，
 * 不依赖访客本地时区，保证手机和电脑看到相同的日期。
 */
export const TIME_ZONE = 'Asia/Shanghai';

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

export function toParts(value: Date | string | number): CalendarParts {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`无效的时间值: ${String(value)}`);
  }
  const map = new Map<string, number>();
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') map.set(part.type, Number(part.value));
  }
  return {
    year: map.get('year') ?? 1970,
    month: map.get('month') ?? 1,
    day: map.get('day') ?? 1,
    hour: map.get('hour') ?? 0,
    minute: map.get('minute') ?? 0,
    second: map.get('second') ?? 0,
  };
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 2026-11-14 */
export function dayKey(value: Date | string | number): string {
  const { year, month, day } = toParts(value);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 2026-11 */
export function monthKey(value: Date | string | number): string {
  const { year, month } = toParts(value);
  return `${year}-${pad2(month)}`;
}

export function yearKey(value: Date | string | number): string {
  return String(toParts(value).year);
}

/** 20:39 */
export function clock(value: Date | string | number): string {
  const { hour, minute } = toParts(value);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 2026年11月14日 */
export function longDate(value: Date | string | number): string {
  const { year, month, day } = toParts(value);
  return `${year}年${month}月${day}日`;
}

/** 11月14日 */
export function shortDate(value: Date | string | number): string {
  const { month, day } = toParts(value);
  return `${month}月${day}日`;
}

/** 2026年11月 */
export function monthLabel(value: Date | string | number): string {
  const { year, month } = toParts(value);
  return `${year}年${month}月`;
}

/** 2026年11月14日 20:39 */
export function stamp(value: Date | string | number): string {
  return `${longDate(value)} ${clock(value)}`;
}

/** 2026-11-14 20:39 */
export function isoStamp(value: Date | string | number): string {
  return `${dayKey(value)} ${clock(value)}`;
}

/** ISO 8601（UTC），用于 <time datetime> 与 frontmatter。 */
export function isoUtc(value: Date | string | number): string {
  return toDate(value).toISOString();
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function weekday(value: Date | string | number): string {
  const date = toDate(value);
  const weekdayIndex = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' })
      .format(date)
      .replace(/\D/g, '') || 0,
  );
  const idx = Number.isNaN(weekdayIndex) ? date.getUTCDay() : weekdayIndex;
  return WEEKDAYS[idx] ?? '';
}

/**
 * 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 昨天 20:39 / 11月14日 / 2024年3月2日
 */
export function relativeTime(
  value: Date | string | number,
  now: Date | string | number = new Date(),
): string {
  const target = toDate(value).getTime();
  const current = toDate(now).getTime();
  const diff = current - target;
  if (Number.isNaN(target) || Number.isNaN(current)) return '';
  if (diff < 0) return shortDate(value);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day && dayKey(value) === dayKey(now)) return `${Math.floor(diff / hour)} 小时前`;

  const dayDiff = Math.round(
    (Date.parse(`${dayKey(now)}T00:00:00Z`) - Date.parse(`${dayKey(value)}T00:00:00Z`)) / day,
  );
  if (dayDiff === 1) return `昨天 ${clock(value)}`;
  if (dayDiff === 2) return `前天 ${clock(value)}`;
  if (dayDiff > 2 && dayDiff < 30) return `${dayDiff} 天前`;
  if (toParts(value).year === toParts(now).year) return shortDate(value);
  return longDate(value);
}

/** 秒级可排序时间戳，用于新想法排序与去重。 */
export function sortKey(value: Date | string | number): number {
  return toDate(value).getTime();
}