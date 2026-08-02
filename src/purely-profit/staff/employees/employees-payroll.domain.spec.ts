import { makeShanghaiMs } from '../../../shared/shanghai-time.utils';
import { resolvePayrollMonthFilter } from './employees-payroll.domain';

describe('employees-payroll.domain 上海时区月界', () => {
  describe('resolvePayrollMonthFilter', () => {
    it('按月返回上海时区月界', () => {
      const filter = resolvePayrollMonthFilter(2026, 8) as {
        gte: Date;
        lt: Date;
      };
      expect(filter.gte.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 7, 1)).getTime(),
      );
      expect(filter.lt.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 8, 1)).getTime(),
      );
    });

    it('payroll.month（UTC 月初零点）能命中上海月界，保证存储兼容', () => {
      const filter = resolvePayrollMonthFilter(2026, 8) as {
        gte: Date;
        lt: Date;
      };
      // EmployeePayroll.month 存储为 UTC 2026-08-01 00:00（上海墙钟落在 8 月）
      const storedMonth = new Date(Date.UTC(2026, 7, 1));
      expect(storedMonth.getTime()).toBeGreaterThanOrEqual(
        filter.gte.getTime(),
      );
      expect(storedMonth.getTime()).toBeLessThan(filter.lt.getTime());
      // 上海 9 月的 payroll（UTC 9/1 00:00）不应落入 8 月范围
      const nextMonthStored = new Date(Date.UTC(2026, 8, 1));
      expect(nextMonthStored.getTime()).toBeGreaterThanOrEqual(
        filter.lt.getTime(),
      );
    });

    it('按年返回上海时区年界', () => {
      const filter = resolvePayrollMonthFilter(2026) as {
        gte: Date;
        lt: Date;
      };
      expect(filter.gte.getTime()).toBe(
        new Date(makeShanghaiMs(2026, 0, 1)).getTime(),
      );
      expect(filter.lt.getTime()).toBe(
        new Date(makeShanghaiMs(2027, 0, 1)).getTime(),
      );
    });

    it('year 缺失时返回 undefined', () => {
      expect(resolvePayrollMonthFilter()).toBeUndefined();
    });
  });
});
