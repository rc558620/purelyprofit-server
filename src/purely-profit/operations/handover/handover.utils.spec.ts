import { buildShiftDateRange } from './handover.utils';

describe('handover.utils', () => {
  describe('buildShiftDateRange', () => {
    it('非法班次时间不应退化为全天范围', () => {
      const baseDate = new Date('2026-06-06T16:25:48.000Z');

      const result = buildShiftDateRange('', '', baseDate);

      expect(result.startAt.getTime()).toBe(
        new Date('2026-06-06T16:25:00.000Z').getTime(),
      );
      expect(result.endAt.getTime()).toBe(
        new Date('2026-06-06T16:25:00.000Z').getTime(),
      );
    });
  });
});
