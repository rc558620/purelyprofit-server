import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import type { PulseAdminMemberRecordChannelValue } from './dto/pulse-membership-admin-member-records.shared.dto';
import { PURCHASE_BONUS_POINTS } from './membership.constants';
import {
  buildMemberRecordCursorWhere,
  compareMemberRecordsDesc,
  type MemberRecordCursor,
} from './membership-admin-member-records.cursor';
import {
  buildMemberRecordStoreFilters,
  formatCents,
  resolveMemberRecordCreatedAtWhere,
  resolveWantedTypes,
} from './membership-admin-member-records.shared';
import type {
  MemberRecordCreatedAtWhere,
  MemberRecordRow,
} from './membership-admin-member-records.types';

/** 一次取数的入参。 */
export interface MemberRecordRowsQuery {
  storeIds: number[];
  query: GetPulseAdminMemberRecordsQueryDto;
  cursor: MemberRecordCursor | null;
  /** 每类各自的取数上限（limit + 1）：多取的一行用来判断 hasMore。 */
  take: number;
}

/**
 * 四类记录各取 `take` 行后归并排序。
 *
 * 四类记录分散在三张表，无法用单条 SQL 一次排好序，因此按「每类各取 limit+1 行 →
 * 内存归并 → 截断」的方式分页：任一类中排在第 limit+2 的行，全局也必然排在第 limit+2 之后
 * （其它三类最多各贡献 limit+1 行），所以归并结果等价于全局排序的前 limit+1 行。
 */
export async function fetchMemberRecordRows(
  prisma: PrismaExecutor,
  { storeIds, query, cursor, take }: MemberRecordRowsQuery,
): Promise<MemberRecordRow[]> {
  const createdAtWhere = resolveMemberRecordCreatedAtWhere(query);
  const wantedTypes = resolveWantedTypes(query.type);

  const [rechargeRows, grantRows, renewalRows, quotaRows] = await Promise.all([
    wantedTypes.has('recharge')
      ? fetchRechargeOrders(prisma, storeIds, createdAtWhere, cursor, take)
      : Promise.resolve<MemberRecordRow[]>([]),
    wantedTypes.has('adminGrant')
      ? fetchAdminGrantOrders(prisma, storeIds, createdAtWhere, cursor, take)
      : Promise.resolve<MemberRecordRow[]>([]),
    wantedTypes.has('renewalAdjust')
      ? fetchRenewalAudits(prisma, storeIds, createdAtWhere, cursor, take)
      : Promise.resolve<MemberRecordRow[]>([]),
    wantedTypes.has('subAccount')
      ? fetchQuotaAudits(prisma, storeIds, createdAtWhere, cursor, take)
      : Promise.resolve<MemberRecordRow[]>([]),
  ]);

  return [...rechargeRows, ...grantRows, ...renewalRows, ...quotaRows].sort(
    compareMemberRecordsDesc,
  );
}

/**
 * 把电话 / 姓名 / 等级条件收敛成门店 id 集合。
 *
 * 会员等级是「当前等级」（与会员列表筛选同一口径），记录本身是历史的：
 * 查「年卡会员的记录」= 查现在还是年卡的门店，而不是查当年买过年卡的门店。
 */
export async function resolveMemberRecordStoreIds(
  prisma: PrismaExecutor,
  storeIds: number[],
  query: GetPulseAdminMemberRecordsQueryDto,
): Promise<number[]> {
  const filters = buildMemberRecordStoreFilters(query);

  // 没有会员维度条件时直接复用权限集合，省一次往返
  if (filters.length === 0) {
    return storeIds;
  }

  const rows = await prisma.store.findMany({
    where: { id: { in: storeIds }, deletedAt: null, AND: filters },
    select: { id: true },
  });

  return rows.map((row) => row.id);
}

// ─── 四类记录 ──────────────────────────────────────────────────────────────

/** 充值记录：商家端下单支付（wechat）的已完成订单。 */
async function fetchRechargeOrders(
  prisma: PrismaExecutor,
  storeIds: number[],
  createdAtWhere: MemberRecordCreatedAtWhere | null,
  cursor: MemberRecordCursor | null,
  take: number,
): Promise<MemberRecordRow[]> {
  const cursorWhere = buildMemberRecordCursorWhere(cursor, 'recharge');

  const orders = await prisma.storeMembershipOrder.findMany({
    where: {
      storeId: { in: storeIds },
      status: 'paid',
      paymentChannel: 'wechat',
      ...createdAtWhere,
      ...(cursorWhere ? { OR: cursorWhere } : {}),
    },
    select: {
      id: true,
      storeId: true,
      planId: true,
      planName: true,
      amount: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });

  return orders.map((order) => ({
    id: order.id,
    type: 'recharge' as const,
    createdAt: order.createdAt,
    storeId: order.storeId,
    planId: null,
    planName: order.planName,
    amountDisplay: formatCents(order.amount),
    pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
    channel: 'wechat' as const,
    // 订单表不记操作人：自助下单的门店即付款人，没有「谁操作的」这一说
    operatorUserId: null,
    operatorName: null,
    oldValueDisplay: null,
    newValueDisplay: null,
    reason: null,
  }));
}

/**
 * 会员等级设置记录：管理端直接给门店设置等级的成交单。
 *
 * 与充值记录同表，用支付渠道区分：admin=勾选「计入收入」（显示金额），gift=赠送（显示「赠送」）。
 */
async function fetchAdminGrantOrders(
  prisma: PrismaExecutor,
  storeIds: number[],
  createdAtWhere: MemberRecordCreatedAtWhere | null,
  cursor: MemberRecordCursor | null,
  take: number,
): Promise<MemberRecordRow[]> {
  const cursorWhere = buildMemberRecordCursorWhere(cursor, 'adminGrant');

  const orders = await prisma.storeMembershipOrder.findMany({
    where: {
      storeId: { in: storeIds },
      status: 'paid',
      paymentChannel: { in: ['admin', 'gift'] },
      ...createdAtWhere,
      ...(cursorWhere ? { OR: cursorWhere } : {}),
    },
    select: {
      id: true,
      storeId: true,
      planId: true,
      planName: true,
      amount: true,
      paymentChannel: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });

  return orders.map((order) => {
    const isGift = order.paymentChannel === 'gift';

    return {
      id: order.id,
      type: 'adminGrant' as const,
      createdAt: order.createdAt,
      storeId: order.storeId,
      planId: null,
      planName: order.planName,
      amountDisplay: isGift ? '赠送' : formatCents(order.amount),
      // 赠送单不走「购买送积分」规则，与会员详情的展示口径保持一致
      pointsAwarded: 0,
      channel: (isGift
        ? 'gift'
        : 'admin') as PulseAdminMemberRecordChannelValue,
      operatorUserId: null,
      operatorName: null,
      oldValueDisplay: null,
      newValueDisplay: null,
      reason: null,
    };
  });
}

/** 调整续费记录：为门店某档位议定基础价的留痕（newPrice 为 null 即清空覆盖、恢复配置价）。 */
async function fetchRenewalAudits(
  prisma: PrismaExecutor,
  storeIds: number[],
  createdAtWhere: MemberRecordCreatedAtWhere | null,
  cursor: MemberRecordCursor | null,
  take: number,
): Promise<MemberRecordRow[]> {
  const cursorWhere = buildMemberRecordCursorWhere(cursor, 'renewalAdjust');

  const audits = await prisma.storeMembershipPriceOverrideAudit.findMany({
    where: {
      storeId: { in: storeIds },
      ...createdAtWhere,
      ...(cursorWhere ? { OR: cursorWhere } : {}),
    },
    select: {
      id: true,
      storeId: true,
      planId: true,
      oldPrice: true,
      newPrice: true,
      operatorName: true,
      reason: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });

  return audits.map((audit) => ({
    id: audit.id,
    type: 'renewalAdjust' as const,
    createdAt: audit.createdAt,
    storeId: audit.storeId,
    planId: audit.planId,
    planName: '',
    amountDisplay: null,
    pointsAwarded: 0,
    channel: null,
    operatorUserId: null,
    operatorName: audit.operatorName ?? null,
    oldValueDisplay: formatCents(audit.oldPrice),
    newValueDisplay: formatCents(audit.newPrice),
    reason: audit.reason ?? null,
  }));
}

/** 子账号设置记录：额度数值变更留痕（newQuota=0 即关闭子账号）。 */
async function fetchQuotaAudits(
  prisma: PrismaExecutor,
  storeIds: number[],
  createdAtWhere: MemberRecordCreatedAtWhere | null,
  cursor: MemberRecordCursor | null,
  take: number,
): Promise<MemberRecordRow[]> {
  const cursorWhere = buildMemberRecordCursorWhere(cursor, 'subAccount');

  const audits = await prisma.storeSubAccountQuotaAudit.findMany({
    where: {
      storeId: { in: storeIds },
      ...createdAtWhere,
      ...(cursorWhere ? { OR: cursorWhere } : {}),
    },
    select: {
      id: true,
      storeId: true,
      oldQuota: true,
      newQuota: true,
      operatorUserId: true,
      reason: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });

  return audits.map((audit) => ({
    id: audit.id,
    type: 'subAccount' as const,
    createdAt: audit.createdAt,
    storeId: audit.storeId,
    planId: null,
    planName: '',
    amountDisplay: null,
    pointsAwarded: 0,
    channel: null,
    operatorUserId: audit.operatorUserId ?? null,
    // 只有 operatorUserId：名字稍后按 id 批量补，查不到时回落 null
    operatorName: null,
    oldValueDisplay: String(audit.oldQuota),
    newValueDisplay: String(audit.newQuota),
    reason: audit.reason ?? null,
  }));
}
