import {
  buildMemberRecordCursorWhere,
  compareMemberRecordsDesc,
  encodeMemberRecordCursor,
  parseMemberRecordCursor,
  type MemberRecordCursor,
} from './membership-admin-member-records.cursor';

const at = (ms: number) => new Date(ms);

/**
 * 四类记录分散在三张表、各自独立自增，游标是这条链路唯一容易出错也最难靠肉眼发现的地方：
 * 两段式游标跨表碰撞会「静默漏一条」，只有翻页到底才发现总数对不上。这里把比较规则锁死。
 */
describe('membership-admin-member-records.cursor', () => {
  describe('编解码', () => {
    it('往返一致（含记录类型）', () => {
      const cursor: MemberRecordCursor = {
        createdAt: at(1_759_084_800_000),
        type: 'adminGrant',
        id: 128,
      };

      expect(parseMemberRecordCursor(encodeMemberRecordCursor(cursor))).toEqual(
        cursor,
      );
    });

    it('空值与非法格式返回 null（由调用方决定报错还是从头查）', () => {
      expect(encodeMemberRecordCursor(null)).toBeNull();
      expect(parseMemberRecordCursor(undefined)).toBeNull();
      expect(parseMemberRecordCursor('')).toBeNull();
      expect(parseMemberRecordCursor('1759084800000_128')).toBeNull();
      expect(parseMemberRecordCursor('1759084800000_unknown_128')).toBeNull();
      expect(parseMemberRecordCursor('0_recharge_1')).toBeNull();
      expect(parseMemberRecordCursor('1759084800000_recharge_0')).toBeNull();
    });
  });

  describe('buildMemberRecordCursorWhere', () => {
    const cursor: MemberRecordCursor = {
      createdAt: at(1_759_084_800_000),
      type: 'adminGrant',
      id: 128,
    };

    it('无游标时不附加条件', () => {
      expect(buildMemberRecordCursorWhere(null, 'recharge')).toBeUndefined();
    });

    it('同类型表：同毫秒只取 id 更小的', () => {
      const where = buildMemberRecordCursorWhere(cursor, 'adminGrant');

      expect(where).toEqual([
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: 128 } },
      ]);
    });

    it('序号更小的表：同毫秒整段都排在游标之后', () => {
      const where = buildMemberRecordCursorWhere(cursor, 'recharge');

      expect(where).toEqual([
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt },
      ]);
    });

    it('序号更大的表：同毫秒的行上一页已返回，不再取', () => {
      const where = buildMemberRecordCursorWhere(cursor, 'renewalAdjust');

      expect(where).toEqual([{ createdAt: { lt: cursor.createdAt } }]);
    });
  });

  describe('compareMemberRecordsDesc', () => {
    it('时间倒序优先', () => {
      const older = { createdAt: at(1000), type: 'recharge' as const, id: 9 };
      const newer = { createdAt: at(2000), type: 'recharge' as const, id: 1 };

      expect(compareMemberRecordsDesc(older, newer)).toBeGreaterThan(0);
    });

    it('同毫秒按类型序号倒序（与游标规则一致）', () => {
      const recharge = {
        createdAt: at(1000),
        type: 'recharge' as const,
        id: 1,
      };
      const adminGrant = {
        createdAt: at(1000),
        type: 'adminGrant' as const,
        id: 1,
      };

      expect(compareMemberRecordsDesc(recharge, adminGrant)).toBeGreaterThan(0);
    });

    it('同毫秒同类型按 id 倒序', () => {
      const small = { createdAt: at(1000), type: 'recharge' as const, id: 1 };
      const large = { createdAt: at(1000), type: 'recharge' as const, id: 2 };

      expect(compareMemberRecordsDesc(small, large)).toBeGreaterThan(0);
    });

    it('跨表 id 相同也不并列：靠类型序号分出先后', () => {
      // 订单 id=128 与审计 id=128 同时存在是常态，两段式游标会在这里漏一条
      const order = { createdAt: at(1000), type: 'recharge' as const, id: 128 };
      const audit = {
        createdAt: at(1000),
        type: 'subAccount' as const,
        id: 128,
      };

      expect(compareMemberRecordsDesc(order, audit)).not.toBe(0);
    });
  });
});
