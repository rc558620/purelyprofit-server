// Pulse / 群发短信账户读模型辅助
//
// 从 `pulse-sms.service.ts` 抽出：门店与短信账户的查询字段、余额健康度口径，
// 以及列表行 DTO 与统计概览的构建函数。
//
// 为什么独立成文件：账户一览是「读 → 内存过滤 → 组装 DTO」的纯逻辑，
// 与余额写链路（Serializable 事务 / 钱包流水）没有共享状态；
// 混在同一个 service 里既会顶过 400 行阈值，也让两条链路难以分别演进。
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from '../../membership/membership-admin-query.helper';
import type { PulseAdminStoreIdentityRecord } from '../../membership/membership.types';
import type {
  PulseAdminSmsAccountDto,
  PulseAdminSmsAccountsResponseDto,
  PulseAdminSmsAccountsStatsDto,
} from './dto/pulse-sms.response.dto';

/** 短信账户列表行所需的最小门店记录：主账号身份 */
export interface PulseSmsStoreRecord extends PulseAdminStoreIdentityRecord {
  id: number;
}

/** 门店 + 主账号身份的查询字段（与会员列表口径保持一致） */
export const SMS_STORE_SELECT = {
  id: true,
  name: true,
  contactPhone: true,
  owner: {
    select: {
      email: true,
      name: true,
      realName: true,
      avatar: true,
      wechatPhone: true,
      lastActiveAt: true,
    },
  },
} as const;

/** 短信账户查询字段 */
export const SMS_ACCOUNT_SELECT = {
  storeId: true,
  balanceFen: true,
  totalRechargedFen: true,
  totalConsumedFen: true,
  sentSmsCount: true,
  updatedAt: true,
} as const;

/** 短信账户行快照：与 SMS_ACCOUNT_SELECT 一一对应，服务内部流转的完整形态 */
export interface PulseSmsAccountRow {
  storeId: number;
  balanceFen: number;
  totalRechargedFen: number;
  totalConsumedFen: number;
  sentSmsCount: number;
  updatedAt: Date;
}

/** 判定余额健康度所需的最小账户信息（从未开过户的门店没有账户行） */
export type SmsBalanceSnapshot = Pick<
  PulseSmsAccountRow,
  'balanceFen' | 'totalConsumedFen'
>;

/**
 * 短信账户余额健康度。
 *
 * 口径必须与前端 `resolveSmsAccountHealth` 完全一致：
 * - 余额 <= 0 且累计消费 > 0 → 已耗尽
 * - 余额 <= 0 且累计消费 = 0 → 未赠送（平台从没给过额度，不能算耗尽）
 * - 余额 > 0 且低于预警阈值 → 预警
 */
export type SmsAccountHealth = 'none' | 'exhausted' | 'warning' | 'healthy';

export const resolveSmsAccountHealth = (
  account: SmsBalanceSnapshot | undefined,
  warningThresholdFen: number,
): SmsAccountHealth => {
  const balanceFen = account?.balanceFen ?? 0;
  if (balanceFen <= 0) {
    return (account?.totalConsumedFen ?? 0) > 0 ? 'exhausted' : 'none';
  }
  return balanceFen < warningThresholdFen ? 'warning' : 'healthy';
};

/** 关键词命中门店名 / 主账号昵称 / 手机号（与前端 toLowerCase().includes 同口径） */
export const matchesSmsStoreKeyword = (
  store: PulseSmsStoreRecord,
  keyword: string | undefined,
): boolean => {
  const normalizedKeyword = keyword?.trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }

  return (
    resolveAdminMemberDisplayName(store)
      .toLowerCase()
      .includes(normalizedKeyword) ||
    resolveAdminMemberPhone(store).includes(normalizedKeyword) ||
    store.name.toLowerCase().includes(normalizedKeyword)
  );
};

/** 门店 + 账户快照 → 列表行 DTO；门店没有账户行时按零余额返回 */
export const buildSmsAccountDto = (
  store: PulseSmsStoreRecord,
  account: PulseSmsAccountRow | undefined,
  warningThresholdFen: number,
): PulseAdminSmsAccountDto => {
  return {
    storeId: String(store.id),
    storeName: store.name,
    ownerName: resolveAdminMemberDisplayName(store),
    ownerPhone: resolveAdminMemberPhone(store),
    ownerAvatarUrl: store.owner.avatar ?? '',
    balanceFen: account?.balanceFen ?? 0,
    totalRechargedFen: account?.totalRechargedFen ?? 0,
    totalConsumedFen: account?.totalConsumedFen ?? 0,
    sentSmsCount: account?.sentSmsCount ?? 0,
    warningThresholdFen,
    updatedAt: account?.updatedAt?.getTime() ?? null,
  };
};

/**
 * 统计概览：只吃 keyword 过滤的完整门店集合。
 * 未赠送（余额 0 且从未消费）不计入「已耗尽」，否则新商家会被误标红。
 */
export const buildSmsAccountsStats = (
  stores: PulseSmsStoreRecord[],
  accountByStoreId: Map<number, PulseSmsAccountRow>,
  warningThresholdFen: number,
): PulseAdminSmsAccountsStatsDto => {
  let totalBalanceFen = 0;
  let warningCount = 0;
  let exhaustedCount = 0;

  for (const store of stores) {
    const account = accountByStoreId.get(store.id);
    totalBalanceFen += account?.balanceFen ?? 0;

    const health = resolveSmsAccountHealth(account, warningThresholdFen);
    if (health === 'warning') {
      warningCount += 1;
    } else if (health === 'exhausted') {
      exhaustedCount += 1;
    }
  }

  return {
    storeCount: stores.length,
    totalBalanceFen,
    warningCount,
    exhaustedCount,
  };
};

/** 无可访问门店时的空分页结果（统计归零，结构与正常分页一致） */
export const buildEmptySmsAccountsPage = (
  page: number,
  pageSize: number,
): PulseAdminSmsAccountsResponseDto => {
  return {
    items: [],
    total: 0,
    page,
    pageSize,
    hasMore: false,
    stats: {
      storeCount: 0,
      totalBalanceFen: 0,
      warningCount: 0,
      exhaustedCount: 0,
    },
  };
};
