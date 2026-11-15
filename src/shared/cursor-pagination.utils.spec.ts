// 游标编解码回归：往返一致、越权形态一律 400、每页条数钳制
import { BadRequestException } from '@nestjs/common';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
  resolveCursorLimit,
} from './cursor-pagination.utils';

const toBase64Url = (json: string): string =>
  Buffer.from(json, 'utf8').toString('base64url');

describe('cursor-pagination.utils', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('往返一致：毫秒排序键 + 主键', () => {
      const encoded = encodeCursor({ keys: [1_763_225_600_000], id: 42 });

      expect(encoded.startsWith('v1:')).toBe(true);
      expect(decodeCursor(encoded)).toEqual({
        keys: [1_763_225_600_000],
        id: 42,
      });
    });

    it('复合排序键按原顺序保留', () => {
      const encoded = encodeCursor({
        keys: [1_763_225_600_000, 'verified'],
        id: 7,
      });

      expect(decodeCursor(encoded)?.keys).toEqual([
        1_763_225_600_000,
        'verified',
      ]);
    });

    it('空串 / 空白 / null / undefined 一律视为第一页', () => {
      expect(decodeCursor(undefined)).toBeNull();
      expect(decodeCursor(null)).toBeNull();
      expect(decodeCursor('')).toBeNull();
      expect(decodeCursor('   ')).toBeNull();
    });

    const invalidCases: Array<[string, string]> = [
      ['缺少版本前缀', toBase64Url('{"keys":[1],"id":1}')],
      ['前缀后不是 JSON', 'v1:not-a-json'],
      ['base64 被截断', 'v1:eyJrZXlzIjpbMSw'],
      ['载荷不是对象', `v1:${toBase64Url('[1,2]')}`],
      ['keys 为空数组', `v1:${toBase64Url('{"keys":[],"id":1}')}`],
      ['keys 超过 4 个', `v1:${toBase64Url('{"keys":[1,2,3,4,5],"id":1}')}`],
      ['id 非正整数', `v1:${toBase64Url('{"keys":[1],"id":0}')}`],
      ['id 传成字符串', `v1:${toBase64Url('{"keys":[1],"id":"7"}')}`],
      ['id 超出安全整数', `v1:${toBase64Url('{"keys":[1],"id":1e300}')}`],
      ['key 是对象', `v1:${toBase64Url('{"keys":[{"a":1}],"id":1}')}`],
      ['超长载荷', `v1:${'a'.repeat(300)}`],
    ];

    it.each(invalidCases)('非法游标抛 400：%s', (_name, raw) => {
      expect(() => decodeCursor(raw)).toThrow(BadRequestException);
      expect(() => decodeCursor(raw)).toThrow(CURSOR_INVALID_MESSAGE);
    });
  });

  describe('resolveCursorLimit', () => {
    const options = { defaultLimit: 20, maxLimit: 50 };

    it('未传 limit 时取默认值', () => {
      expect(resolveCursorLimit(undefined, options)).toBe(20);
    });

    it('区间内的值原样返回', () => {
      expect(resolveCursorLimit(30, options)).toBe(30);
    });

    it('超过上限钳到上限，不因迁移放大单页体积', () => {
      expect(resolveCursorLimit(999, options)).toBe(50);
    });

    it('小于 1 钳到 1', () => {
      expect(resolveCursorLimit(0, options)).toBe(1);
      expect(resolveCursorLimit(-5, options)).toBe(1);
    });

    it('非有限数一律回退默认值，不做上限猜测', () => {
      expect(resolveCursorLimit(Number.NaN, options)).toBe(20);
      expect(resolveCursorLimit(Number.POSITIVE_INFINITY, options)).toBe(20);
    });

    it('小数向下取整', () => {
      expect(resolveCursorLimit(12.9, options)).toBe(12);
    });
  });
});
