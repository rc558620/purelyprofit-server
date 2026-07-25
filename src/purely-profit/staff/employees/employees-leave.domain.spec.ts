import { BadRequestException } from '@nestjs/common';
import {
  calculateLeaveDays,
  assertLeaveBusinessRules,
} from './employees-leave.domain';

// ─── calculateLeaveDays ────────────────────────────────────────

describe('calculateLeaveDays', () => {
  /** 基准时间戳（毫秒），避免使用 0 */
  const BASE = 1740000000000;
  const hourMs = (h: number) => h * 60 * 60 * 1000;

  it('8 小时 = 1 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(8))).toBe(1);
  });

  it('4 小时 = 0.5 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(4))).toBe(0.5);
  });

  it('小于 4 小时 = 0.5 天（最小单位）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(2))).toBe(0.5);
  });

  it('1 小时 = 0.5 天（最小单位）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(1))).toBe(0.5);
  });

  it('12 小时 = 1.5 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(12))).toBe(1.5);
  });

  it('16 小时 = 2 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(16))).toBe(2);
  });

  it('24 小时 = 3 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(24))).toBe(3);
  });

  it('10 小时 = 1 天（8 + 2，余量 2h < 4h → 不进位）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(10))).toBe(1);
  });

  it('14 小时 = 1.5 天（8 + 6，余量 6h ≥ 4h → +0.5）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(14))).toBe(1.5);
  });

  it('20 小时 = 2.5 天（16 + 4，余量 ≥ 4 → 0.5）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(20))).toBe(2.5);
  });

  it('跨越多天的场景：72 小时 = 9 天', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(72))).toBe(9);
  });

  it('endDate <= startDate 时抛出 BadRequestException', () => {
    expect(() => calculateLeaveDays(1000, 1000)).toThrow(BadRequestException);
    expect(() => calculateLeaveDays(2000, 1000)).toThrow(BadRequestException);
  });

  it('带分钟精度的场景：8h30m → 1 天（余量 0.5h < 4h）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(8) + 30 * 60 * 1000)).toBe(1);
  });

  it('带分钟精度的场景：8h10m → 1 天（余量 0.17h < 4h）', () => {
    expect(calculateLeaveDays(BASE, BASE + hourMs(8) + 10 * 60 * 1000)).toBe(1);
  });
});

// ─── assertLeaveBusinessRules ──────────────────────────────────

describe('assertLeaveBusinessRules', () => {
  it('startDate > endDate 时抛出异常', () => {
    expect(() =>
      assertLeaveBusinessRules({
        startDate: 2000,
        endDate: 1000,
        days: 1,
        deductSalary: false,
        deductAmount: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it('days <= 0 时抛出异常', () => {
    expect(() =>
      assertLeaveBusinessRules({
        startDate: 1000,
        endDate: 2000,
        days: 0,
        deductSalary: false,
        deductAmount: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it('未扣薪但 deductAmount > 0 时抛出异常', () => {
    expect(() =>
      assertLeaveBusinessRules({
        startDate: 1000,
        endDate: 2000,
        days: 1,
        deductSalary: false,
        deductAmount: 100,
      }),
    ).toThrow(BadRequestException);
  });

  it('合法输入不抛异常', () => {
    expect(() =>
      assertLeaveBusinessRules({
        startDate: 1000,
        endDate: 2000,
        days: 1,
        deductSalary: true,
        deductAmount: 100,
      }),
    ).not.toThrow();
  });
});
