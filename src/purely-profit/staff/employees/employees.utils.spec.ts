import { makeShanghaiMs } from '../../../shared/shanghai-time.utils';
import {
  buildDateRange,
  getCurrentMonthString,
  getMonthEndExclusive,
  getMonthStart,
  getStartOfCurrentMonth,
  normalizeMonthValue,
} from './employees.utils';

describe('employees.utils 上海时区边界', () => {
  describe('getMonthStart / getMonthEndExclusive', () => {
    it('getMonthStart 返回上海时区当月 1 号 00:00，而非 UTC 月首', () => {
      // 上海 2026-08-01 00:00 = UTC 2026-07-31 16:00
      const expected = new Date(makeShanghaiMs(2026, 7, 1));
      expect(getMonthStart(2026, 8).getTime()).toBe(expected.getTime());
      // 与 UTC 月首（2026-08-01T00:00Z）不同，验证修复
      expect(getMonthStart(2026, 8).getTime()).not.toBe(Date.UTC(2026, 7, 1));
    });

    it('getMonthEndExclusive 返回上海时区次月 1 号 00:00', () => {
      const expected = new Date(makeShanghaiMs(2026, 8, 1)); // 上海 2026-09-01 00:00
      expect(getMonthEndExclusive(2026, 8).getTime()).toBe(expected.getTime());
    });
  });

  describe('buildDateRange', () => {
    it('按月构建上海时区月界', () => {
      const range = buildDateRange(2026, 8)!;
      expect(range.gte.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 7, 1)).getTime(),
      );
      expect(range.lt.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 8, 1)).getTime(),
      );
    });

    it('上海 8/1 排班日（UTC 7/31 16:00）应落入 8 月范围，旧 UTC 月界会漏掉', () => {
      const range = buildDateRange(2026, 8)!;
      // 排班 employeeShift.date 存储为上海日界：上海 2026-08-01 00:00
      const shiftOnAugFirst = new Date(makeShanghaiMs(2026, 7, 1));
      expect(shiftOnAugFirst.getTime()).toBeGreaterThanOrEqual(
        range.gte.getTime(),
      );
      expect(shiftOnAugFirst.getTime()).toBeLessThan(range.lt.getTime());
      // 旧实现 gte = UTC 2026-08-01 00:00，会将上海 8/1 的排班排除
      expect(shiftOnAugFirst.getTime()).toBeLessThan(Date.UTC(2026, 7, 1));
    });

    it('按年构建上海时区年界', () => {
      const range = buildDateRange(2026)!;
      expect(range.gte.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 0, 1)).getTime(),
      );
      expect(range.lt.getTime()).toBe(
        new Date(makeShanghaiMs(2027, 0, 1)).getTime(),
      );
    });

    it('year 缺失时返回 undefined', () => {
      expect(buildDateRange()).toBeUndefined();
    });
  });

  describe('getStartOfCurrentMonth', () => {
    it('上海 8/1 00:30 判定当前月为 8 月（旧 UTC 逻辑会判成 7 月）', () => {
      // 上海 2026-08-01 00:30 = UTC 2026-07-31 16:30
      const now = new Date(makeShanghaiMs(2026, 7, 1, 0, 30));
      const result = getStartOfCurrentMonth(now);
      expect(result.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 7, 1)).getTime(),
      );
    });
  });

  describe('getCurrentMonthString', () => {
    it('上海 8/1 00:30 输出 2026-08（UTC 会输出 2026-07）', () => {
      const now = new Date(makeShanghaiMs(2026, 7, 1, 0, 30));
      expect(getCurrentMonthString(now)).toBe('2026-08');
    });
  });

  describe('normalizeMonthValue', () => {
    it('保持 payroll 存储约定：转为 UTC 当月 1 号零点', () => {
      expect(normalizeMonthValue('2026-08').getTime()).toBe(
        Date.UTC(2026, 7, 1),
      );
    });
  });
});
