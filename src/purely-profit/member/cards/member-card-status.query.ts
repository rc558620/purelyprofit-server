/**
 * 持卡状态查询条件（商家端 / C 端共用唯一实现）。
 *
 * 为什么不能直接 `where.status = status`：
 * 数据库目前只有「手动调次」会写 exhausted，`active → expired` 没有任何写入路径，
 * 过期卡与次数用尽的卡长期停在 active。若筛选只比对 DB 状态，
 * 「已过期」「次数用尽」两个 Tab 会系统性查不到数据，
 * 而列表展示侧（前端按剩余天数 / 剩余次数派生）却显示为已过期 / 已用尽 —— 两端自相矛盾。
 *
 * 因此筛选口径统一为「DB 状态 ∪ 运行时判定」，与展示侧派生口径保持一致：
 * - expired   = DB expired 或（active 且已过到期时间且未「次数用尽」）
 * - exhausted = DB exhausted 或（active 的次数卡剩余次数 <= 0）
 * - active    = DB active 且未过期且次数未用尽（否则同一张卡会同时命中「生效中」与「已过期」）
 * - 其余状态  = 直接比对 DB 状态
 */
import type { Prisma } from '@prisma/client';
import type { MemberCardStatusValue } from './member-card.constants';

/** 按持卡状态构造查询条件；status 未传返回 undefined 表示不筛选 */
export function buildMemberCardStatusWhere(
  status: MemberCardStatusValue | undefined,
  now: Date,
): Prisma.MemberCardWhereInput | undefined {
  if (!status) {
    return undefined;
  }

  if (status === 'expired') {
    // expiresAt 为 null 表示不设到期（长期有效），不参与过期判定。
    //
    // active 分支必须排除「次数已用尽」的次数卡：展示侧（toCardView /
    // resolveMemberCardDisplayStatus）的优先级是「次数用尽 > 已过期」，
    // 不排除就会出现「在已过期 Tab 里看到徽标为次数用尽的卡」的筛选错位。
    return {
      OR: [
        { status: 'expired' },
        {
          status: 'active',
          expiresAt: { lte: now },
          OR: [{ kind: { not: 'times' } }, { remainTimes: { gt: 0 } }],
        },
      ],
    };
  }

  if (status === 'exhausted') {
    return {
      OR: [
        { status: 'exhausted' },
        { status: 'active', kind: 'times', remainTimes: { lte: 0 } },
      ],
    };
  }

  if (status === 'active') {
    // 「生效中」必须排除已过期 / 次数用尽，否则筛选结果与 Tab 语义冲突
    return {
      status: 'active',
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ kind: { not: 'times' } }, { remainTimes: { gt: 0 } }] },
      ],
    };
  }

  return { status };
}
