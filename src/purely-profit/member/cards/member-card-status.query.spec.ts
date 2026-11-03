// 持卡状态筛选条件：过期 / 用尽必须由「DB 状态 ∪ 运行时判定」取并集
import { buildMemberCardStatusWhere } from './member-card-status.query';

describe('buildMemberCardStatusWhere', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');

  it('未传状态时不做任何筛选', () => {
    expect(buildMemberCardStatusWhere(undefined, now)).toBeUndefined();
  });

  it('已过期：覆盖已翻转的 expired 与「active 但已过到期时间」的存量卡', () => {
    expect(buildMemberCardStatusWhere('expired', now)).toEqual({
      OR: [
        { status: 'expired' },
        {
          status: 'active',
          expiresAt: { lte: now },
          // 展示侧「次数用尽」优先于「已过期」，筛选必须同步排除，否则同一张卡会同时命中两个 Tab
          OR: [{ kind: { not: 'times' } }, { remainTimes: { gt: 0 } }],
        },
      ],
    });
  });

  it('次数用尽：覆盖已翻转的 exhausted 与「active 但剩余 0 次」的存量卡', () => {
    expect(buildMemberCardStatusWhere('exhausted', now)).toEqual({
      OR: [
        { status: 'exhausted' },
        { status: 'active', kind: 'times', remainTimes: { lte: 0 } },
      ],
    });
  });

  it('生效中：必须排除已过期与次数用尽，否则同一张卡会同时命中两个 Tab', () => {
    expect(buildMemberCardStatusWhere('active', now)).toEqual({
      status: 'active',
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ kind: { not: 'times' } }, { remainTimes: { gt: 0 } }] },
      ],
    });
  });

  it('冻结 / 已退款：直接比对数据库状态', () => {
    expect(buildMemberCardStatusWhere('frozen', now)).toEqual({
      status: 'frozen',
    });
    expect(buildMemberCardStatusWhere('refunded', now)).toEqual({
      status: 'refunded',
    });
  });
});
