// ─── 营销中心 Service ─────────────────────────────────────────────────
//
// 字段对齐前端约定：
//   - 金额单位：分（数据库存整数），前端显示时除以 100
//   - 时间戳单位：毫秒（.getTime()），前端 new Date(ts) 还原
//   - 手机号：数据库存明文，响应层统一脱敏（maskPhone）
//   - 会员等级：由 totalSpent 字段实时计算（calcCustomerTier），同时写入 tier 列加速查询

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateConsumptionDto,
  CreateCustomerDto,
  CreatePromotionDto,
  CreateRechargeDto,
  ListCustomerPointsRecordsQueryDto,
  ListCustomersQueryDto,
  ListPointsRecordsQueryDto,
  ListPromotionsQueryDto,
  ListRechargesQueryDto,
  UpdateCustomerDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import type {
  MarketingConsumptionDto,
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingOverviewDto,
  MarketingPointsRecordDto,
  MarketingPointsRecordsResponseDto,
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingAccessService } from './marketing-access.service';
import {
  toNullableMediaText,
  toOptionalMediaText,
} from '../commerce/commerce.utils';
import {
  buildMarketingPaginationMeta,
  calcCustomerStatus,
  calcCustomerTier,
  calcPromotionStatus,
  calcRechargeTotal,
  maskPhone,
  resolveMarketingPagination,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionTypeValue,
  type MarketingRechargeTypeValue,
} from './marketing.utils';

// ─── 内部 raw 行类型（$queryRaw 映射）────────────────────────────────

interface CustomerRow {
  id: number;
  storeId: number;
  name: string;
  phone: string | null;
  avatar: string | null;
  tier: string;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: Date | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RechargeRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  giftAmount: number;
  type: string;
  promotionId: number | null;
  promotionName: string | null;
  note: string | null;
  createdAt: Date;
}

interface ConsumptionRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  balancePaid: number;
  pointsDeducted: number;
  payType: string;
  itemsSummary: string | null;
  promotionId: number | null;
  promotionName: string | null;
  createdAt: Date;
}

interface PointsRecordRow {
  id: number;
  storeId: number;
  customerId: number;
  amount: number;
  type: string;
  description: string;
  createdAt: Date;
}

interface CountRow {
  count: number;
}

interface PromotionRow {
  id: number;
  storeId: number;
  name: string;
  type: string;
  description: string;
  params: unknown;
  startAt: Date;
  endAt: Date;
  usageCount: number;
  totalDiscount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface OverviewTrendPoint {
  date: string;
  amount: number;
}

interface OverviewMonthlyTrendPoint {
  label: string;
  amount: number | null;
}

const OVERVIEW_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);

// ─── Mapper helpers ───────────────────────────────────────────────────

function mapCustomerRow(row: CustomerRow): MarketingCustomerDto {
  return {
    id: String(row.id),
    name: row.name,
    phone: maskPhone(row.phone),
    avatar: toOptionalMediaText(row.avatar) ?? undefined,
    tier: row.tier as MarketingCustomerDto['tier'],
    balance: row.balance,
    points: row.points,
    totalSpent: row.totalSpent,
    visitCount: row.visitCount,
    registeredAt: row.createdAt.getTime(),
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.getTime() : null,
    status: calcCustomerStatus(row.lastVisitAt),
    remark: row.remark ?? undefined,
  };
}

function mapRechargeRow(row: RechargeRow): MarketingRechargeDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    customerName: row.customerName,
    amount: row.amount,
    giftAmount: row.giftAmount,
    type: row.type as MarketingRechargeTypeValue,
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

function mapConsumptionRow(row: ConsumptionRow): MarketingConsumptionDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    amount: row.amount,
    balancePaid: row.balancePaid,
    pointsDeducted: row.pointsDeducted,
    payType: row.payType as MarketingPayTypeValue,
    itemsSummary: row.itemsSummary ?? undefined,
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
    createdAt: row.createdAt.getTime(),
  };
}

function mapPointsRecordRow(row: PointsRecordRow): MarketingPointsRecordDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    amount: row.amount,
    type: row.type as MarketingPointsChangeTypeValue,
    description: row.description,
    createdAt: row.createdAt.getTime(),
  };
}

function buildPointsSpendDescription(itemsSummary?: string | null): string {
  const normalizedSummary = itemsSummary?.trim();
  if (normalizedSummary) {
    return `消费抵扣：${normalizedSummary}`;
  }
  return '消费抵扣积分';
}

function normalizePromotionParams(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

  return Object.fromEntries(entries);
}

function mapPromotionRow(row: PromotionRow): MarketingPromotionDto {
  return {
    id: String(row.id),
    name: row.name,
    type: row.type as MarketingPromotionTypeValue,
    description: row.description,
    params: normalizePromotionParams(row.params),
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    usageCount: row.usageCount,
    totalDiscount: row.totalDiscount,
    enabled: row.enabled,
    status: calcPromotionStatus(row.startAt, row.endAt),
    createdAt: row.createdAt.getTime(),
  };
}

function buildOverviewLast30Days(
  rechargeRows: Array<{ createdAt: Date; amount: number; giftAmount: number }>,
): OverviewTrendPoint[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rangeStart = new Date(todayStart.getTime() - 29 * 86400_000);

  const buckets = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(rangeStart.getTime() + index * 86400_000);
    return {
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      amount: 0,
    } satisfies OverviewTrendPoint;
  });

  for (const row of rechargeRows) {
    const createdAt = new Date(row.createdAt);
    createdAt.setHours(0, 0, 0, 0);
    const bucketIndex = Math.floor(
      (createdAt.getTime() - rangeStart.getTime()) / 86400_000,
    );
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].amount += calcRechargeTotal(
        row.amount,
        row.giftAmount,
      );
    }
  }

  return buckets;
}

function buildOverviewMonthlyTrend(
  rechargeRows: Array<{ createdAt: Date; amount: number; giftAmount: number }>,
  year: number,
): OverviewMonthlyTrendPoint[] {
  const monthly = OVERVIEW_MONTH_LABELS.map((label) => ({
    label,
    amount: null as number | null,
  }));

  for (const row of rechargeRows) {
    const createdAt = new Date(row.createdAt);
    if (createdAt.getFullYear() !== year) {
      continue;
    }

    const monthIndex = createdAt.getMonth();
    monthly[monthIndex].amount =
      (monthly[monthIndex].amount ?? 0) +
      calcRechargeTotal(row.amount, row.giftAmount);
  }

  return monthly;
}

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: MarketingAccessService,
  ) {}

  // ── Overview ────────────────────────────────────────────────────────

  async getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      storeId,
    );
    if (!resolvedStoreId) {
      return this.emptyOverview();
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);

    const [
      activeMemberCount,
      balanceSum,
      totalRechargeAgg,
      todayRechargeAgg,
      thisMonthRechargeAgg,
      rechargeCount,
      trendRechargeRows,
    ] = await Promise.all([
      this.prisma.marketingCustomer.count({
        where: { storeId: resolvedStoreId, visitCount: { gt: 0 } },
      }),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId: resolvedStoreId },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId: resolvedStoreId },
      }),
      this.prisma.marketingRecharge.findMany({
        where: {
          storeId: resolvedStoreId,
          createdAt: { gte: previousYearStart },
          type: { in: ['recharge', 'gift'] },
        },
        select: { createdAt: true, amount: true, giftAmount: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRecharge =
      (totalRechargeAgg._sum.amount ?? 0) +
      (totalRechargeAgg._sum.giftAmount ?? 0);
    const todayRecharge =
      (todayRechargeAgg._sum.amount ?? 0) +
      (todayRechargeAgg._sum.giftAmount ?? 0);
    const thisMonthRecharge =
      (thisMonthRechargeAgg._sum.amount ?? 0) +
      (thisMonthRechargeAgg._sum.giftAmount ?? 0);

    const currentYear = now.getFullYear();

    return {
      totalBalance: balanceSum._sum.balance ?? 0,
      totalRecharge,
      todayRecharge,
      thisMonthRecharge,
      rechargeCount,
      activeMemberCount,
      last30Days: buildOverviewLast30Days(trendRechargeRows),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend(trendRechargeRows, currentYear),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend(
        trendRechargeRows,
        currentYear - 1,
      ),
    };
  }

  private emptyOverview(): MarketingOverviewDto {
    const currentYear = new Date().getFullYear();

    return {
      totalBalance: 0,
      totalRecharge: 0,
      todayRecharge: 0,
      thisMonthRecharge: 0,
      rechargeCount: 0,
      activeMemberCount: 0,
      last30Days: buildOverviewLast30Days([]),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear - 1),
    };
  }

  // ── Customers ───────────────────────────────────────────────────────

  async listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto & { storeId?: number },
  ): Promise<MarketingCustomersResponseDto> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      query.storeId,
    );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    // 构造 status 对应的时间范围过滤
    const now = new Date();
    const cutoff30 = new Date(now.getTime() - 30 * 86400_000);
    const cutoff90 = new Date(now.getTime() - 90 * 86400_000);

    const where: Prisma.MarketingCustomerWhereInput = {
      storeId: resolvedStoreId,
    };

    if (query.status === 'active') {
      where.lastVisitAt = { gte: cutoff30 };
    } else if (query.status === 'dormant') {
      where.lastVisitAt = { gte: cutoff90, lt: cutoff30 };
    } else if (query.status === 'lost') {
      where.OR = [{ lastVisitAt: { lt: cutoff90 } }, { lastVisitAt: null }];
    }

    if (query.tier) {
      (where as Prisma.MarketingCustomerWhereInput & { tier?: string }).tier =
        query.tier;
    }

    if (query.keyword) {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { phone: { contains: query.keyword } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.marketingCustomer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          storeId: true,
          name: true,
          phone: true,
          avatar: true,
          tier: true,
          balance: true,
          points: true,
          totalSpent: true,
          visitCount: true,
          lastVisitAt: true,
          remark: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.marketingCustomer.count({ where }),
    ]);

    return {
      items: rows.map(mapCustomerRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const [recentRecharges, recentConsumptions, rechargeSummary] = await Promise.all([
      this.prisma.$queryRaw<RechargeRow[]>`
        SELECT
          r.id,
          r.store_id AS "storeId",
          r.customer_id AS "customerId",
          c.name AS "customerName",
          r.amount,
          r.gift_amount AS "giftAmount",
          r.type::text AS "type",
          r.promotion_id AS "promotionId",
          p.name AS "promotionName",
          r.note,
          r.created_at AS "createdAt"
        FROM marketing_recharges r
        JOIN marketing_customers c ON c.id = r.customer_id
        LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
        WHERE r.customer_id = ${customerId}
        ORDER BY r.created_at DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<ConsumptionRow[]>`
        SELECT
          co.id,
          co.store_id AS "storeId",
          co.customer_id AS "customerId",
          c.name AS "customerName",
          co.amount,
          co.balance_paid AS "balancePaid",
          co.points_deducted AS "pointsDeducted",
          co.pay_type::text AS "payType",
          co.items_summary AS "itemsSummary",
          co.promotion_id AS "promotionId",
          p.name AS "promotionName",
          co.created_at AS "createdAt"
        FROM marketing_consumptions co
        JOIN marketing_customers c ON c.id = co.customer_id
        LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
        WHERE co.customer_id = ${customerId}
        ORDER BY co.created_at DESC
        LIMIT 5
      `,
      this.prisma.marketingRecharge.aggregate({
        where: { customerId },
        _sum: { amount: true, giftAmount: true },
      }),
    ]);

    return {
      ...mapCustomerRow(customer),
      totalRecharge:
        (rechargeSummary._sum.amount ?? 0) +
        (rechargeSummary._sum.giftAmount ?? 0),
      recentRecharges: recentRecharges.map(mapRechargeRow),
      recentConsumptions: recentConsumptions.map(mapConsumptionRow),
    };
  }

  async createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    await this.accessService.ensureCanAccess(user, storeId, 'marketing:manage');

    // 手机号去重（同一门店内唯一）
    if (dto.phone) {
      const existing = await this.prisma.marketingCustomer.findUnique({
        where: { storeId_phone: { storeId, phone: dto.phone } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('该手机号的顾客已存在');
      }
    }

    const created = await this.prisma.marketingCustomer.create({
      data: {
        storeId,
        name: dto.name,
        phone: dto.phone?.trim() || null,
        avatar: toNullableMediaText(dto.avatar),
        remark: dto.remark?.trim() || null,
        tier: 'regular',
      },
    });

    return mapCustomerRow(created);
  }

  async updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    // 手机号变更时做唯一性校验
    if (dto.phone !== undefined && dto.phone !== customer.phone) {
      const normalizedPhone = dto.phone.trim();
      if (normalizedPhone !== '') {
        const existing = await this.prisma.marketingCustomer.findUnique({
          where: {
            storeId_phone: {
              storeId: customer.storeId,
              phone: normalizedPhone,
            },
          },
          select: { id: true },
        });
        if (existing && existing.id !== customerId) {
          throw new ConflictException('该手机号的顾客已存在');
        }
      }
    }

    const updated = await this.prisma.marketingCustomer.update({
      where: { id: customerId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.avatar !== undefined
          ? { avatar: toNullableMediaText(dto.avatar) }
          : {}),
        ...(dto.remark !== undefined
          ? { remark: dto.remark.trim() || null }
          : {}),
      },
    });

    return mapCustomerRow(updated);
  }

  async deleteCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<void> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    await this.prisma.marketingCustomer.delete({ where: { id: customerId } });
  }

  // ── Recharges ───────────────────────────────────────────────────────

  async listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto & { storeId?: number },
  ): Promise<MarketingRechargesResponseDto> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      query.storeId,
    );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const where: Prisma.MarketingRechargeWhereInput = {
      storeId: resolvedStoreId,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.startMs || query.endMs
        ? {
            createdAt: {
              ...(query.startMs ? { gte: new Date(query.startMs) } : {}),
              ...(query.endMs ? { lte: new Date(query.endMs) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<RechargeRow[]>`
        SELECT
          r.id,
          r.store_id AS "storeId",
          r.customer_id AS "customerId",
          c.name AS "customerName",
          r.amount,
          r.gift_amount AS "giftAmount",
          r.type::text AS "type",
          r.promotion_id AS "promotionId",
          p.name AS "promotionName",
          r.note,
          r.created_at AS "createdAt"
        FROM marketing_recharges r
        JOIN marketing_customers c ON c.id = r.customer_id
        LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
        WHERE r.store_id = ${resolvedStoreId}
          ${query.customerId ? Prisma.sql`AND r.customer_id = ${query.customerId}` : Prisma.empty}
          ${query.startMs ? Prisma.sql`AND r.created_at >= ${new Date(query.startMs)}` : Prisma.empty}
          ${query.endMs ? Prisma.sql`AND r.created_at <= ${new Date(query.endMs)}` : Prisma.empty}
        ORDER BY r.created_at DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.marketingRecharge.count({ where }),
    ]);

    return {
      items: rows.map(mapRechargeRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<RechargeRow[]>`
        SELECT
          r.id,
          r.store_id AS "storeId",
          r.customer_id AS "customerId",
          c.name AS "customerName",
          r.amount,
          r.gift_amount AS "giftAmount",
          r.type::text AS "type",
          r.promotion_id AS "promotionId",
          p.name AS "promotionName",
          r.note,
          r.created_at AS "createdAt"
        FROM marketing_recharges r
        JOIN marketing_customers c ON c.id = r.customer_id
        LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
        WHERE r.customer_id = ${customerId}
        ORDER BY r.created_at DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.marketingRecharge.count({ where: { customerId } }),
    ]);

    return {
      items: rows.map(mapRechargeRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
    await this.accessService.ensureCanAccess(user, storeId, 'marketing:manage');

    const customer = await this.findCustomerOrThrow(dto.customerId);
    if (customer.storeId !== storeId) {
      throw new BadRequestException('顾客不属于该门店');
    }

    // 退款时金额为负向调整（余额减少），限额不能超过当前余额
    const rechargeType = dto.type ?? 'recharge';
    const giftAmount = dto.giftAmount ?? 0;
    const totalIn = dto.amount + giftAmount;

    if (rechargeType === 'refund' && customer.balance < dto.amount) {
      throw new BadRequestException('退款金额不能超过顾客当前余额');
    }

    // 事务：创建充值记录 + 更新余额
    const [rechargeRecord] = await this.prisma.$transaction(async (tx) => {
      const recharge = await tx.marketingRecharge.create({
        data: {
          storeId,
          customerId: dto.customerId,
          amount: dto.amount,
          giftAmount,
          type: rechargeType as never,
          promotionId: dto.promotionId ?? null,
          note: dto.note?.trim() || null,
        },
      });

      // 余额变动：退款减少，充值/赠送增加
      const balanceDelta = rechargeType === 'refund' ? -dto.amount : totalIn;

      await tx.marketingCustomer.update({
        where: { id: dto.customerId },
        data: { balance: { increment: balanceDelta } },
      });

      // 同步更新活动 usageCount（如有）
      if (dto.promotionId) {
        await tx.marketingPromotion.updateMany({
          where: { id: dto.promotionId, storeId },
          data: { usageCount: { increment: 1 } },
        });
      }

      return [recharge] as const;
    });

    // 返回完整 DTO（含 customerName / promotionName）
    const rows = await this.prisma.$queryRaw<RechargeRow[]>`
      SELECT
        r.id, r.store_id AS "storeId", r.customer_id AS "customerId",
        c.name AS "customerName", r.amount, r.gift_amount AS "giftAmount",
        r.type::text AS "type", r.promotion_id AS "promotionId",
        p.name AS "promotionName", r.note, r.created_at AS "createdAt"
      FROM marketing_recharges r
      JOIN marketing_customers c ON c.id = r.customer_id
      LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
      WHERE r.id = ${rechargeRecord.id}
      LIMIT 1
    `;

    return mapRechargeRow(rows[0]);
  }

  // ── Points Records ──────────────────────────────────────────────────

  async listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto & { storeId?: number },
  ): Promise<MarketingPointsRecordsResponseDto> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      query.storeId,
    );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<PointsRecordRow[]>`
        SELECT
          pr.id,
          pr.store_id AS "storeId",
          pr.customer_id AS "customerId",
          pr.amount,
          pr.type::text AS "type",
          pr.description,
          pr.created_at AS "createdAt"
        FROM marketing_points_records pr
        WHERE pr.store_id = ${resolvedStoreId}
          ${query.customerId ? Prisma.sql`AND pr.customer_id = ${query.customerId}` : Prisma.empty}
          ${query.type ? Prisma.sql`AND pr.type = ${query.type}::"MarketingPointsChangeType"` : Prisma.empty}
          ${query.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(query.startMs)}` : Prisma.empty}
          ${query.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(query.endMs)}` : Prisma.empty}
        ORDER BY pr.created_at DESC, pr.id DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM marketing_points_records pr
        WHERE pr.store_id = ${resolvedStoreId}
          ${query.customerId ? Prisma.sql`AND pr.customer_id = ${query.customerId}` : Prisma.empty}
          ${query.type ? Prisma.sql`AND pr.type = ${query.type}::"MarketingPointsChangeType"` : Prisma.empty}
          ${query.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(query.startMs)}` : Prisma.empty}
          ${query.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(query.endMs)}` : Prisma.empty}
      `,
    ]);
    const total = countRows[0]?.count ?? 0;

    return {
      items: rows.map(mapPointsRecordRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async listCustomerPointsRecords(
    user: AuthenticatedUser,
    customerId: number,
    query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<PointsRecordRow[]>`
        SELECT
          pr.id,
          pr.store_id AS "storeId",
          pr.customer_id AS "customerId",
          pr.amount,
          pr.type::text AS "type",
          pr.description,
          pr.created_at AS "createdAt"
        FROM marketing_points_records pr
        WHERE pr.customer_id = ${customerId}
          ${query.type ? Prisma.sql`AND pr.type = ${query.type}::"MarketingPointsChangeType"` : Prisma.empty}
          ${query.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(query.startMs)}` : Prisma.empty}
          ${query.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(query.endMs)}` : Prisma.empty}
        ORDER BY pr.created_at DESC, pr.id DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM marketing_points_records pr
        WHERE pr.customer_id = ${customerId}
          ${query.type ? Prisma.sql`AND pr.type = ${query.type}::"MarketingPointsChangeType"` : Prisma.empty}
          ${query.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(query.startMs)}` : Prisma.empty}
          ${query.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(query.endMs)}` : Prisma.empty}
      `,
    ]);
    const total = countRows[0]?.count ?? 0;

    return {
      items: rows.map(mapPointsRecordRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  // ── Consumptions ────────────────────────────────────────────────────

  async listConsumptions(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number; storeId?: number },
  ): Promise<MarketingConsumptionsResponseDto> {
    const customer = await this.findCustomerOrThrow(customerId);
    await this.accessService.ensureCanAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<ConsumptionRow[]>`
        SELECT
          co.id, co.store_id AS "storeId", co.customer_id AS "customerId",
          c.name AS "customerName", co.amount,
          co.balance_paid AS "balancePaid",
          co.points_deducted AS "pointsDeducted",
          co.pay_type::text AS "payType",
          co.items_summary AS "itemsSummary",
          co.promotion_id AS "promotionId",
          p.name AS "promotionName",
          co.created_at AS "createdAt"
        FROM marketing_consumptions co
        JOIN marketing_customers c ON c.id = co.customer_id
        LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
        WHERE co.customer_id = ${customerId}
        ORDER BY co.created_at DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.marketingConsumption.count({ where: { customerId } }),
    ]);

    return {
      items: rows.map(mapConsumptionRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async createConsumption(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateConsumptionDto,
  ): Promise<MarketingConsumptionDto> {
    await this.accessService.ensureCanAccess(user, storeId, 'marketing:manage');

    const customer = await this.findCustomerOrThrow(dto.customerId);
    if (customer.storeId !== storeId) {
      throw new BadRequestException('顾客不属于该门店');
    }

    const balancePaid = dto.balancePaid ?? 0;
    const pointsDeducted = dto.pointsDeducted ?? 0;
    const payType = dto.payType ?? 'cash';

    if (balancePaid > customer.balance) {
      throw new BadRequestException('余额支付金额不能超过顾客当前余额');
    }
    if (balancePaid > dto.amount) {
      throw new BadRequestException('余额支付金额不能超过消费金额');
    }

    const [consumptionRecord] = await this.prisma.$transaction(async (tx) => {
      const consumption = await tx.marketingConsumption.create({
        data: {
          storeId,
          customerId: dto.customerId,
          amount: dto.amount,
          balancePaid,
          pointsDeducted,
          payType: payType as never,
          itemsSummary: dto.itemsSummary?.trim() || null,
          promotionId: dto.promotionId ?? null,
        },
      });

      // 更新顾客统计：余额、消费汇总、等级
      const newTotalSpent = customer.totalSpent + dto.amount;
      const newTier = calcCustomerTier(newTotalSpent) as never;

      await tx.marketingCustomer.update({
        where: { id: dto.customerId },
        data: {
          balance: { decrement: balancePaid },
          points: { decrement: pointsDeducted },
          totalSpent: { increment: dto.amount },
          visitCount: { increment: 1 },
          lastVisitAt: new Date(),
          tier: newTier,
        },
      });

      if (pointsDeducted > 0) {
        await tx.$executeRaw`
          INSERT INTO marketing_points_records (
            store_id,
            customer_id,
            amount,
            type,
            description
          )
          VALUES (
            ${storeId},
            ${dto.customerId},
            ${-pointsDeducted},
            ${'spend'}::"MarketingPointsChangeType",
            ${buildPointsSpendDescription(dto.itemsSummary)}
          )
        `;
      }

      // 同步活动统计
      if (dto.promotionId) {
        await tx.marketingPromotion.updateMany({
          where: { id: dto.promotionId, storeId },
          data: {
            usageCount: { increment: 1 },
          },
        });
      }

      return [consumption] as const;
    });

    const rows = await this.prisma.$queryRaw<ConsumptionRow[]>`
      SELECT
        co.id, co.store_id AS "storeId", co.customer_id AS "customerId",
        c.name AS "customerName", co.amount,
        co.balance_paid AS "balancePaid", co.points_deducted AS "pointsDeducted",
        co.pay_type::text AS "payType", co.items_summary AS "itemsSummary",
        co.promotion_id AS "promotionId", p.name AS "promotionName",
        co.created_at AS "createdAt"
      FROM marketing_consumptions co
      JOIN marketing_customers c ON c.id = co.customer_id
      LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
      WHERE co.id = ${consumptionRecord.id}
      LIMIT 1
    `;

    return mapConsumptionRow(rows[0]);
  }

  // ── Promotions ───────────────────────────────────────────────────────

  async listPromotions(
    user: AuthenticatedUser,
    query: ListPromotionsQueryDto & { storeId?: number },
  ): Promise<MarketingPromotionsResponseDto> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      query.storeId,
    );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const now = new Date();
    const where: Prisma.MarketingPromotionWhereInput = {
      storeId: resolvedStoreId,
    };

    if (query.status === 'upcoming') {
      where.startAt = { gt: now };
    } else if (query.status === 'active') {
      where.startAt = { lte: now };
      where.endAt = { gte: now };
    } else if (query.status === 'ended') {
      where.endAt = { lt: now };
    }

    const [rows, total] = await Promise.all([
      this.prisma.marketingPromotion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.marketingPromotion.count({ where }),
    ]);

    return {
      items: rows.map(mapPromotionRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getPromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<MarketingPromotionDto> {
    const promotion = await this.prisma.marketingPromotion.findUnique({
      where: { id: promotionId },
    });

    if (!promotion) {
      throw new NotFoundException('活动不存在');
    }

    await this.accessService.ensureCanAccess(
      user,
      promotion.storeId,
      'marketing:view',
    );
    return mapPromotionRow(promotion);
  }

  async createPromotion(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    await this.accessService.ensureCanAccess(user, storeId, 'marketing:manage');

    if (dto.endAt <= dto.startAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const created = await this.prisma.marketingPromotion.create({
      data: {
        storeId,
        name: dto.name.trim(),
        type: dto.type as never,
        description: dto.description?.trim() ?? '',
        params: (dto.params ?? {}) as Prisma.InputJsonValue,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        enabled: dto.enabled ?? true,
      },
    });

    return mapPromotionRow(created);
  }

  async updatePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    const promotion = await this.prisma.marketingPromotion.findUnique({
      where: { id: promotionId },
    });
    if (!promotion) {
      throw new NotFoundException('活动不存在');
    }
    await this.accessService.ensureCanAccess(
      user,
      promotion.storeId,
      'marketing:manage',
    );

    const newStartAt =
      dto.startAt !== undefined ? new Date(dto.startAt) : promotion.startAt;
    const newEndAt =
      dto.endAt !== undefined ? new Date(dto.endAt) : promotion.endAt;

    if (newEndAt <= newStartAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const updated = await this.prisma.marketingPromotion.update({
      where: { id: promotionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.params !== undefined
          ? { params: dto.params as Prisma.InputJsonValue }
          : {}),
        ...(dto.startAt !== undefined ? { startAt: newStartAt } : {}),
        ...(dto.endAt !== undefined ? { endAt: newEndAt } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });

    return mapPromotionRow(updated);
  }

  async deletePromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<void> {
    const promotion = await this.prisma.marketingPromotion.findUnique({
      where: { id: promotionId },
    });
    if (!promotion) {
      throw new NotFoundException('活动不存在');
    }
    await this.accessService.ensureCanAccess(
      user,
      promotion.storeId,
      'marketing:manage',
    );
    await this.prisma.marketingPromotion.delete({ where: { id: promotionId } });
  }

  async togglePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    enabled: boolean,
  ): Promise<MarketingPromotionDto> {
    return this.updatePromotion(user, promotionId, { enabled });
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private async findCustomerOrThrow(customerId: number): Promise<CustomerRow> {
    const rows = await this.prisma.$queryRaw<CustomerRow[]>`
      SELECT
        id, store_id AS "storeId", name, phone, avatar, tier::text AS "tier",
        balance, points, total_spent AS "totalSpent",
        visit_count AS "visitCount",
        last_visit_at AS "lastVisitAt", remark,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM marketing_customers
      WHERE id = ${customerId}
      LIMIT 1
    `;

    if (!rows[0]) {
      throw new NotFoundException('顾客不存在');
    }

    return rows[0];
  }
}
