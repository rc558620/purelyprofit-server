import {
  resolveTimestamp,
  toIsoStringOrNull,
  toTimestamp,
} from './date-coerce.utils';

describe('date-coerce.utils', () => {
  describe('toTimestamp', () => {
    it('Date / ISO 字符串 / 数字时间戳三种入参返回一致结果', () => {
      const iso = '2026-10-01T08:00:00.000Z';
      const expected = new Date(iso).getTime();

      expect(toTimestamp(new Date(iso))).toBe(expected);
      // 缓存反序列化后的形态：字符串，直接调 .getTime() 会抛错
      expect(toTimestamp(iso)).toBe(expected);
      expect(toTimestamp(expected)).toBe(expected);
    });

    it('非法字符串返回 NaN（由调用方决定如何处理）', () => {
      expect(toTimestamp('不是日期')).toBeNaN();
    });
  });

  describe('resolveTimestamp', () => {
    it('空值回落兜底值', () => {
      expect(resolveTimestamp(null, 100)).toBe(100);
      expect(resolveTimestamp(undefined, 100)).toBe(100);
      expect(resolveTimestamp('', 100)).toBe(100);
    });

    it('非法值回落兜底值，不把 NaN 泄漏到比较与排序', () => {
      expect(resolveTimestamp('不是日期', 100)).toBe(100);
    });

    it('合法值返回对应时间戳', () => {
      const iso = '2026-10-01T08:00:00.000Z';
      expect(resolveTimestamp(iso, 0)).toBe(new Date(iso).getTime());
    });
  });

  describe('toIsoStringOrNull', () => {
    it('Date 与 ISO 字符串均输出规范 ISO 串', () => {
      const iso = '2026-10-01T08:00:00.000Z';
      expect(toIsoStringOrNull(new Date(iso))).toBe(iso);
      expect(toIsoStringOrNull(iso)).toBe(iso);
    });

    it('空值与非法值返回 null', () => {
      expect(toIsoStringOrNull(null)).toBeNull();
      expect(toIsoStringOrNull(undefined)).toBeNull();
      expect(toIsoStringOrNull('')).toBeNull();
      expect(toIsoStringOrNull('不是日期')).toBeNull();
    });
  });
});
