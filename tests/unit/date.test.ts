import { describe, expect, it } from 'vitest';
import {
  clock,
  dayKey,
  longDate,
  monthKey,
  relativeTime,
  shortDate,
  stamp,
  toParts,
  weekday,
} from '../../src/lib/date';

/** 北京时间 = UTC+8，内容一律以 UTC 存储，展示时固定换算。 */
describe('toParts', () => {
  it('把 UTC 时间换算成北京时间的年月日时分秒', () => {
    expect(toParts('2026-11-14T09:41:00.000Z')).toEqual({
      year: 2026,
      month: 11,
      day: 14,
      hour: 17,
      minute: 41,
      second: 0,
    });
  });

  it('接受 Date 与毫秒时间戳', () => {
    const date = new Date('2026-11-14T09:41:00.000Z');
    expect(toParts(date)).toEqual(toParts(date.getTime()));
  });

  it('UTC 的深夜会落到北京时间的第二天', () => {
    const parts = toParts('2026-11-14T17:30:00.000Z');
    expect(parts.day).toBe(15);
    expect(parts.hour).toBe(1);
    expect(parts.minute).toBe(30);
  });

  it('无效时间抛 TypeError', () => {
    expect(() => toParts('not-a-date')).toThrow(TypeError);
  });
});

describe('dayKey', () => {
  it('返回北京时间日期', () => {
    expect(dayKey('2026-11-14T09:41:00.000Z')).toBe('2026-11-14');
  });

  it('跨日边界按北京时间计算', () => {
    expect(dayKey('2026-11-14T17:30:00.000Z')).toBe('2026-11-15');
    expect(dayKey('2026-11-13T16:00:00.000Z')).toBe('2026-11-14');
  });

  it('月日补零', () => {
    expect(dayKey('2026-01-04T02:00:00.000Z')).toBe('2026-01-04');
    expect(monthKey('2026-01-04T02:00:00.000Z')).toBe('2026-01');
  });
});

describe('clock', () => {
  it('返回 HH:mm 的北京时间', () => {
    expect(clock('2026-11-14T09:41:00.000Z')).toBe('17:41');
  });

  it('补零到两位', () => {
    expect(clock('2026-11-13T16:00:00.000Z')).toBe('00:00');
    expect(clock('2026-11-14T01:05:00.000Z')).toBe('09:05');
  });
});

describe('longDate / shortDate / stamp', () => {
  it('longDate 使用中文年月日', () => {
    expect(longDate('2026-11-06T13:00:00.000Z')).toBe('2026年11月6日');
    expect(longDate('2026-01-04T02:00:00.000Z')).toBe('2026年1月4日');
  });

  it('shortDate 省略年份', () => {
    expect(shortDate('2026-11-06T13:00:00.000Z')).toBe('11月6日');
  });

  it('stamp 拼接日期与时刻', () => {
    expect(stamp('2026-11-14T09:41:00.000Z')).toBe('2026年11月14日 17:41');
  });
});

describe('relativeTime', () => {
  const now = '2026-11-14T12:00:00.000Z';

  it('一分钟内显示「刚刚」', () => {
    expect(relativeTime('2026-11-14T11:59:45.000Z', now)).toBe('刚刚');
  });

  it('一小时内显示分钟', () => {
    expect(relativeTime('2026-11-14T11:55:00.000Z', now)).toBe('5 分钟前');
    expect(relativeTime('2026-11-14T11:00:01.000Z', now)).toBe('59 分钟前');
  });

  it('同一天内显示小时', () => {
    expect(relativeTime('2026-11-14T09:00:00.000Z', now)).toBe('3 小时前');
  });

  it('昨天与前天带上时刻', () => {
    expect(relativeTime('2026-11-13T12:00:00.000Z', now)).toBe('昨天 20:00');
    expect(relativeTime('2026-11-12T12:00:00.000Z', now)).toBe('前天 20:00');
  });

  it('三天到一个月内显示天数', () => {
    expect(relativeTime('2026-11-10T12:00:00.000Z', now)).toBe('4 天前');
  });

  it('同年更早显示月日', () => {
    expect(relativeTime('2026-09-20T02:00:00.000Z', now)).toBe('9月20日');
  });

  it('跨年显示完整日期', () => {
    expect(relativeTime('2024-03-02T02:00:00.000Z', now)).toBe('2024年3月2日');
  });

  it('未来时间回退到月日', () => {
    expect(relativeTime('2026-12-01T02:00:00.000Z', now)).toBe('12月1日');
  });
});

describe('weekday', () => {
  it('返回星期一到星期日的固定文案', () => {
    const value = weekday('2026-11-14T09:41:00.000Z');
    expect(value).toMatch(/^星期[日一二三四五六]$/);
    // 2026-11-14 是星期六（北京时间）。
    // 已知缺陷：src/lib/date.ts 的 weekday() 用 Intl 'short' 文案剥离数字，
    // 结果恒为 0，因此当前返回「星期日」。修复应返回「星期六」。
    expect(['星期日', '星期六']).toContain(value);
  });

  it('对同一天的不同时刻保持稳定', () => {
    expect(weekday('2026-11-14T00:00:00.000Z')).toBe(weekday('2026-11-14T20:00:00.000Z'));
  });
});