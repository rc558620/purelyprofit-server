import { ConflictException, Injectable } from '@nestjs/common';
import type { MembershipPlanCycle, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import {
  buildDateRange,
  buildSingleDayRange,
} from '../dashboard/dashboard-time.utils';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership-admin-logs.shared.dto';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import type {
  PulseAdminMemberRecordChannelValue,
  PulseAdminMemberRecordTypeValue,
} from './dto/pulse-membership-admin-member-records.shared.dto';
import type {
  PulseAdminMemberRecordItemDto,
  PulseAdminMemberRecordsResponseDto,
} from './dto/pulse-membership-admin-member-records.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildMemberRecordCursorWhere,
  compareMemberRecordsDesc,
  encodeMemberRecordCursor,
  parseMemberRecordCursor,
  type MemberRecordCursor,
} from './membership-admin-member-records.cursor';
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from './membership-admin-query.helper';
import { buildAdminMemberLevelStoreWhere } from './membership-admin-store-where.utils';
import { PURCHASE_BONUS_POINTS } from './membership.constants';

/** 分（库存储单位）→ 元展示串；审计行缺列（旧数据 / 残行）时为 undefined，不能渲染成 NaN。 */
function formatCents(cents: number | null | undefined): string | null {
  if (typeof cents !== 'number') {
    return null;
  }

  return Money.fromDbCents(cents).toFixedOutputYuan().replace(/\.00$/, '');
}

/**
 * createdAt 过滤片段：三张表的查询条件只用 gte / lte 两个键。
 *
 * 刻意用结构子集而非 Prisma 生成的模型级 WhereInput —— 后者跟随
 * `prisma generate` 的时序，schema 新增了模型而 client 未重新生成时
 * 会解析成 error type（等同 any），类型保护整条失效。
 * 结构子集 spread 进 where 后，仍由 Prisma 的参数类型做结构校验。
 */
interface MemberRecordCreatedAtWhere {
  createdAt: {
    gte?: Date;
    lte?: Date;
  };
}

/** 排序前的统一行形态：四类原始记录先拍平到这里，再统一排序与映射。 */
interface MemberRecordRow extends MemberRecordCursor {
  storeId: number;
  /** 改价审计只存 planId，档位名由套餐目录补全；其余类型直接用行内名称。 */
  planId: MembershipPlanCycle | null;
  planName: string;
  amountDisplay: string | null;
  pointsAwarded: number;
  channel: PulseAdminMemberRecordChannelValue | null;
  /** 子账号审计只有 operatorUserId，名字在捞到行之后批量补。 */
  operatorUserId: number | null;
  operatorName: string | null;
  oldValueDisplay: string | null;
  newValueDisplay: string | null;
  reason: string | null;
}

const EMPTY_PAGE: PulseAdminMemberRecordsResponseDto = {
  items: [],
  hasMore: false,
  nextCursor: null,
};

/**
 * 会员记录管理：跨会员聚合四类记录的时间轴（游标分页）。
 *
 * 四类记录分散在三张表，无法用单条 SQL 一次排好序，因此按「每类各取 limit+1 行 →
 * 内存归并 → 截断」的方式分页：任一类中排在第 limit+2 的行，全局也必然排在第 limit+2 之后
 * （其它三类最多各贡献 limit+1 行），所以归并结果等价于全局排序的前 limit+1 行。
 */
@Injectable()
export class PulseMembershipAdminMemberRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  async listMemberRecords(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<PulseAdminMemberRecordsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    if (storeIds.length === 0) {
      return EMPTY_PAGE;
    }

    if (query.cursor && !parseMemberRecordCursor(query.cursor)) {
      throw new ConflictException('cursor 格式不合法');
    }

    const cursor = parseMemberRecordCursor(query.cursor);
    const limit = query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT;
    const take = limit + 1;

    // 电话 / 姓名 / 等级都是会员（门店）维度的条件，先收敛成门店 id 集合，
    // 后面的四类查询统一用 storeId in (...) —— 改价审计表没有 store 关系，只能这么过滤
    const memberStoreIds = await this.resolveMemberStoreIds(storeIds, query);
    if (memberStoreIds.length === 0) {
      return EMPTY_PAGE;
    }

    const createdAtWhere = this.resolveCreatedAtWhere(query);
    const wantedTypes = resolveWantedTypes(query.type);

    const [rechargeRows, grantRows, renewalRows, quotaRows] = await Promise.all(
      [
        wantedTypes.has('recharge')
          ? this.fetchRechargeOrders(
              memberStoreIds,
              createdAtWhere,
              cursor,
              take,
            )
          : Promise.resolve<MemberRecordRow[]>([]),
        wantedTypes.has('adminGrant')
          ? this.fetchAdminGrantOrders(
              memberStoreIds,
              createdAtWhere,
              cursor,
              take,
            )
          : Promise.resolve<MemberRecordRow[]>([]),
        wantedTypes.has('renewalAdjust')
          ? this.fetchRenewalAudits(
              memberStoreIds,
              createdAtWhere,
              cursor,
              take,
            )
          : Promise.resolve<MemberRecordRow[]>([]),
        wantedTypes.has('subAccount')
          ? this.fetchQuotaAudits(memberStoreIds, createdAtWhere, cursor, take)
          : Promise.resolve<MemberRecordRow[]>([]),
      ],
    );

    const rows = [
      ...rechargeRows,
      ...grantRows,
      ...renewalRows,
      ...quotaRows,
    ].sort(compareMemberRecordsDesc);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: await this.buildItems(pageRows),
      hasMore,
      nextCursor: hasMore
        ? encodeMemberRecordCursor(pageRows.at(-1) ?? null)
        : null,
    };
  }

  // ─── 四类记录 ──────────────────────────────────────────────────────────────

  /** 充值记录：商家端下单支付（wechat）的已完成订单。 */
  private async fetchRechargeOrders(
    storeIds: number[],
    createdAtWhere: MemberRecordCreatedAtWhere | null,
    cursor: MemberRecordCursor | null,
    take: number,
  ): Promise<MemberRecordRow[]> {
    const cursorWhere = buildMemberRecordCursorWhere(cursor, 'recharge');

    const orders = await this.prisma.storeMembershipOrder.findMany({
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
  private async fetchAdminGrantOrders(
    storeIds: number[],
    createdAtWhere: MemberRecordCreatedAtWhere | null,
    cursor: MemberRecordCursor | null,
    take: number,
  ): Promise<MemberRecordRow[]> {
    const cursorWhere = buildMemberRecordCursorWhere(cursor, 'adminGrant');

    const orders = await this.prisma.storeMembershipOrder.findMany({
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
  private async fetchRenewalAudits(
    storeIds: number[],
    createdAtWhere: MemberRecordCreatedAtWhere | null,
    cursor: MemberRecordCursor | null,
    take: number,
  ): Promise<MemberRecordRow[]> {
    const cursorWhere = buildMemberRecordCursorWhere(cursor, 'renewalAdjust');

    const audits = await this.prisma.storeMembershipPriceOverrideAudit.findMany(
      {
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
      },
    );

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
  private async fetchQuotaAudits(
    storeIds: number[],
    createdAtWhere: MemberRecordCreatedAtWhere | null,
    cursor: MemberRecordCursor | null,
    take: number,
  ): Promise<MemberRecordRow[]> {
    const cursorWhere = buildMemberRecordCursorWhere(cursor, 'subAccount');

    const audits = await this.prisma.storeSubAccountQuotaAudit.findMany({
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

  // ─── 会员维度筛选 ──────────────────────────────────────────────────────────

  /**
   * 把电话 / 姓名 / 等级条件收敛成门店 id 集合。
   *
   * 会员等级是「当前等级」（与会员列表筛选同一口径），记录本身是历史的：
   * 查「年卡会员的记录」= 查现在还是年卡的门店，而不是查当年买过年卡的门店。
   */
  private async resolveMemberStoreIds(
    storeIds: number[],
    query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<number[]> {
    const phone = query.phone?.trim();
    const name = query.name?.trim();
    const filters: Prisma.StoreWhereInput[] = [];

    if (phone) {
      const normalizedPhone = phone.replace(/\s+/g, '');
      filters.push({
        OR: [
          { contactPhone: { contains: normalizedPhone } },
          { owner: { wechatPhone: { contains: normalizedPhone } } },
          {
            owner: {
              email: { contains: normalizedPhone, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (name) {
      filters.push({
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { owner: { name: { contains: name, mode: 'insensitive' } } },
          { owner: { realName: { contains: name, mode: 'insensitive' } } },
        ],
      });
    }

    const levelWhere = buildAdminMemberLevelStoreWhere({ level: query.level });
    if (levelWhere) {
      filters.push(levelWhere);
    }

    // 没有会员维度条件时直接复用权限集合，省一次往返
    if (filters.length === 0) {
      return storeIds;
    }

    const rows = await this.prisma.store.findMany({
      where: { id: { in: storeIds }, deletedAt: null, AND: filters },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /**
   * 日期条件：单独日期优先于区间（前端保证两组互斥，这里再兜一层）。
   * 按上海时区取整天，区间两端都填时闭区间、早填晚填会自动互换。
   *
   * 只填一端是**开放区间**（「从这天起」/「到这天止」），不能退化成「这一天」：
   * 前端明确按开放区间提示（摘要写「不限 ~ 某天」），退化成单日会让
   * 「查 9 月以来的记录」查出一个空列表，运营会读成「这段时间真没记录」。
   */
  private resolveCreatedAtWhere(
    query: GetPulseAdminMemberRecordsQueryDto,
  ): MemberRecordCreatedAtWhere | null {
    if (query.date) {
      const range = buildSingleDayRange(query.date);
      return {
        createdAt: { gte: new Date(range.start), lte: new Date(range.end) },
      };
    }

    const { startDate, endDate } = query;

    if (startDate && endDate) {
      const range = buildDateRange(startDate, endDate);
      return {
        createdAt: { gte: new Date(range.start), lte: new Date(range.end) },
      };
    }

    if (startDate) {
      const range = buildSingleDayRange(startDate);
      return { createdAt: { gte: new Date(range.start) } };
    }

    if (endDate) {
      const range = buildSingleDayRange(endDate);
      return { createdAt: { lte: new Date(range.end) } };
    }

    return null;
  }

  // ─── 行 → DTO ─────────────────────────────────────────────────────────────

  private async buildItems(
    rows: MemberRecordRow[],
  ): Promise<PulseAdminMemberRecordItemDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const storeIds = [...new Set(rows.map((row) => row.storeId))];
    const operatorIds = [
      ...new Set(
        rows
          .map((row) => row.operatorUserId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    // 档位目录只为改价审计服务：本页没有改价记录时不查，省一次往返
    const needsPlanCatalog = rows.some((row) => row.planId !== null);

    const [stores, operatorNameById, planCatalog] = await Promise.all([
      this.prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: {
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
        },
      }),
      operatorIds.length === 0
        ? Promise.resolve(new Map<number, string>())
        : this.loadOperatorNames(operatorIds),
      needsPlanCatalog ? loadPlanCatalog(this.prisma) : Promise.resolve([]),
    ]);

    const storeById = new Map(stores.map((store) => [store.id, store]));
    const planNameById = new Map(
      planCatalog.map((plan) => [plan.id, plan.name]),
    );

    return rows.map((row) => {
      const store = storeById.get(row.storeId);
      const planName = row.planId
        ? (planNameById.get(row.planId) ?? row.planId)
        : row.planName;

      return {
        id: String(row.id),
        type: row.type,
        memberId: String(row.storeId),
        memberName: store ? resolveAdminMemberDisplayName(store) : '',
        memberPhone: store ? resolveAdminMemberPhone(store) : '',
        planName,
        amountDisplay: row.amountDisplay,
        pointsAwarded: row.pointsAwarded,
        channel: row.channel,
        operatorName:
          row.operatorName ??
          (typeof row.operatorUserId === 'number'
            ? (operatorNameById.get(row.operatorUserId) ?? null)
            : null),
        oldValueDisplay: row.oldValueDisplay,
        newValueDisplay: row.newValueDisplay,
        reason: row.reason,
        createdAt: row.createdAt.getTime(),
      };
    });
  }

  /** 操作人展示名：realName → name 逐级回落，都没有时不写入 Map（前端按「系统」兜底）。 */
  private async loadOperatorNames(
    userIds: number[],
  ): Promise<Map<number, string>> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, realName: true },
    });

    const nameById = new Map<number, string>();
    for (const user of users) {
      const displayName = user.realName?.trim() || user.name?.trim();
      if (displayName) {
        nameById.set(user.id, displayName);
      }
    }

    return nameById;
  }
}

/** 类型筛选：all 时四类都查，否则只查选中的那一类。 */
function resolveWantedTypes(
  type: GetPulseAdminMemberRecordsQueryDto['type'],
): Set<PulseAdminMemberRecordTypeValue> {
  if (!type || type === 'all') {
    return new Set(['recharge', 'adminGrant', 'renewalAdjust', 'subAccount']);
  }

  return new Set([type]);
}
