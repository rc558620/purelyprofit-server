import { BadRequestException } from '@nestjs/common';
import { encodeCursor } from '../../shared/cursor-pagination.utils';
import {
  buildFinanceAccountCursorWhere,
  buildFinanceAccountNullSegmentWhere,
  decodeFinanceAccountCursor,
  encodeFinanceAccountCursor,
  resolveFinanceAccountPaging,
} from './finance-account.cursor';

describe('账款列表游标分页', () => {
  const dueDate = new Date('2026-05-12T00:00:00.000Z');
  const updatedAt = new Date('2026-05-12T10:10:00.000Z');

  describe('编解码', () => {
    it('有到期日的行可以原样往返', () => {
      const cursor = decodeFinanceAccountCursor(
        encodeFinanceAccountCursor({ dueDate, updatedAt, id: 42 }),
      );

      expect(cursor).toEqual({ dueDate, updatedAt, id: 42 });
    });

    it('无到期日的行用哨兵编码，解码后仍是 null（不能变成 1970 年）', () => {
      const cursor = decodeFinanceAccountCursor(
        encodeFinanceAccountCursor({ dueDate: null, updatedAt, id: 7 }),
      );

      expect(cursor).toEqual({ dueDate: null, updatedAt, id: 7 });
    });

    it('空值视为第一页', () => {
      expect(decodeFinanceAccountCursor(undefined)).toBeNull();
      expect(decodeFinanceAccountCursor('')).toBeNull();
      expect(decodeFinanceAccountCursor(null)).toBeNull();
    });

    it('排序键个数不匹配时按参数错误拒绝，避免静默返回第一页', () => {
      // 其它列表的游标键个数/语义与本接口不同，混用时必须 400 而不是当成第一页
      const oneKeyCursor = encodeCursor({
        keys: [updatedAt.getTime()],
        id: 42,
      });

      expect(() => decodeFinanceAccountCursor(oneKeyCursor)).toThrow(
        BadRequestException,
      );
    });

    it('第一级键小于 NULL 哨兵（负数时间戳）判为非法', () => {
      const invalidCursor = encodeCursor({
        keys: [-5, updatedAt.getTime()],
        id: 42,
      });

      expect(() => decodeFinanceAccountCursor(invalidCursor)).toThrow(
        BadRequestException,
      );
    });

    it('非法游标统一抛 400', () => {
      expect(() => decodeFinanceAccountCursor('v1:not-base64-json')).toThrow(
        BadRequestException,
      );
      expect(() => decodeFinanceAccountCursor('v9:eyJrZXlzIjpbXX0')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('游标条件', () => {
    it('有到期日段必须带 dueDate >= 下推，三个 OR 分支逐级比较', () => {
      const where = buildFinanceAccountCursorWhere({
        dueDate,
        updatedAt,
        id: 42,
      });

      expect(where).toEqual({
        // 这一层是索引起点的来源；删掉它深页会退化成 O(offset)
        dueDate: { gte: dueDate },
        OR: [
          { dueDate: { gt: dueDate } },
          { dueDate, updatedAt: { lt: updatedAt } },
          { dueDate, updatedAt, id: { lt: 42 } },
        ],
      });
      // 回归：NULL 段不能混进同一个 OR，否则 gte 下推会被 OR 抵消
      expect(JSON.stringify(where)).not.toContain('"dueDate":null');
    });

    it('游标行有到期日时，NULL 尾段取该段全部行', () => {
      expect(
        buildFinanceAccountNullSegmentWhere({
          dueDate,
          updatedAt,
          id: 42,
        }),
      ).toEqual({ dueDate: null });
    });

    it('游标行无到期日时只在 NULL 段内推进，不能把前段行重复读出', () => {
      const where = buildFinanceAccountNullSegmentWhere({
        dueDate: null,
        updatedAt,
        id: 42,
      });

      expect(where).toEqual({
        dueDate: null,
        OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: 42 } }],
      });
      // 回归：这里若出现 dueDate: { gt } 分支，会把已读过的前段行又翻出来
      expect(JSON.stringify(where)).not.toContain('"gt"');
    });
  });

  describe('分页参数归一', () => {
    it('未传 cursor 时按 page/pageSize 计算 offset', () => {
      expect(resolveFinanceAccountPaging({ page: 3, pageSize: 20 })).toEqual({
        page: 3,
        limit: 20,
        offset: 40,
        cursor: null,
      });
    });

    it('缺省参数回退到财务域默认分页', () => {
      const paging = resolveFinanceAccountPaging({});

      expect(paging.page).toBe(1);
      expect(paging.offset).toBe(0);
      expect(paging.cursor).toBeNull();
    });

    it('cursor 存在时优先走游标路径', () => {
      const paging = resolveFinanceAccountPaging({
        cursor: encodeFinanceAccountCursor({ dueDate: null, updatedAt, id: 9 }),
      });

      expect(paging.cursor).toEqual({ dueDate: null, updatedAt, id: 9 });
      expect(paging.offset).toBe(0);
    });
  });
});
