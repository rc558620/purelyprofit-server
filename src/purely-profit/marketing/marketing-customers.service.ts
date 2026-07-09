import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ClubMemberLevelValue } from '../../purely-club/member/dto/club-member-account.dto';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { RedisService } from '../../redis/redis.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildMarketingCustomersListCacheKey,
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailCacheKey,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';
import { toNullableMediaText } from '../commerce/commerce.utils';
import { Money } from '../../shared/money.utils';
import type {
  AdjustCustomerPointsDto,
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/marketing-query.dto';
import type {
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
} from './dto/marketing-response.dto';
import {
  mapConsumptionRow,
  mapCustomerRow,
  mapRechargeRow,
} from './marketing.mapper';
import { buildCustomerWhere } from './marketing.domain';
import {
  queryCustomerGiftBalanceCents,
  queryCustomerRecentConsumptions,
  queryCustomerRecentRecharges,
  queryCustomerRowById,
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  normalizePhone,
  resolveMarketingPagination,
} from './marketing.utils';

const MARKETING_CUSTOMERS_LIST_CACHE_TTL_SECONDS = 60;
const MARKETING_CUSTOMERS_LIST_REFRESH_AFTER_MS = 20_000;
// F8: 顾客详情缓存 TTL（15 秒，短于列表 60s，避免过度延迟）
const MARKETING_CUSTOMER_DETAIL_CACHE_TTL_SECONDS = 15;

@Injectable()
export class MarketingCustomersService {
  private readonly logger = new Logger(MarketingCustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(
          0,
          1,
          resolveMarketingPagination(query.page, query.pageSize).take,
        ),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const statusFilter = query.status ?? 'all';
    const tierFilter = query.tier ?? 'all';
    const keywordFilter = query.keyword ?? '';
    const nameFilter = query.name ?? '';
    const phoneFilter = query.phone ?? '';
    const cacheKey = buildMarketingCustomersListCacheKey(
      resolvedStoreId,
      statusFilter,
      tierFilter,
      keywordFilter,
      page,
      take,
      nameFilter,
      phoneFilter,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_CUSTOMERS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_CUSTOMERS_LIST_REFRESH_AFTER_MS,
      loadValue: () =>
        this.queryCustomers(
          resolvedStoreId,
          statusFilter,
          tierFilter,
          keywordFilter,
          nameFilter,
          phoneFilter,
          skip,
          take,
          page,
        ),
    });
  }

  private async queryCustomers(
    resolvedStoreId: number,
    statusFilter: string,
    tierFilter: string,
    keywordFilter: string,
    nameFilter: string,
    phoneFilter: string,
    skip: number,
    take: number,
    page: number,
  ): Promise<MarketingCustomersResponseDto> {
    const where = buildCustomerWhere({
      storeId: resolvedStoreId,
      status:
        statusFilter !== 'all'
          ? (statusFilter as 'active' | 'dormant' | 'lost')
          : undefined,
      tier:
        tierFilter !== 'all'
          ? (tierFilter as 'regular' | 'gold' | 'diamond')
          : undefined,
      keyword: keywordFilter || undefined,
      name: nameFilter || undefined,
      phone: phoneFilter || undefined,
    });

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

    // 对 avatar 为 null 的行，通过多种路径从 users 表 fallback 获取头像
    const phones = rows
      .filter((r) => !r.avatar && r.phone)
      .map((r) => r.phone as string);

    if (phones.length > 0) {
      const emailVariants = phones.flatMap((p) => [
        `club_phone_${p}@purelyprofit.local`,
        `phone_${p}@purelyprofit.local`,
      ]);

      const usersWithAvatar = await this.prisma.user.findMany({
        where: {
          OR: [
            { wechatPhone: { in: phones } },
            { email: { in: emailVariants } },
          ],
        },
        select: {
          id: true,
          wechatPhone: true,
          email: true,
          avatar: true,
          wechatAvatar: true,
        },
      });

      // F6: 构建分层映射，确保头像解析优先级与详情页 SQL CASE ORDER BY 一致
      // 优先级: wechat_phone(1) → club_phone email(2) → phone_ email(3)
      const phoneAvatarMap = new Map<string, string>();
      const emailAvatarMap = new Map<string, string>();
      for (const u of usersWithAvatar) {
        const avatarUrl = u.avatar ?? u.wechatAvatar;
        if (avatarUrl) {
          if (u.wechatPhone) phoneAvatarMap.set(u.wechatPhone, avatarUrl);
          if (u.email) emailAvatarMap.set(u.email, avatarUrl);
        }
      }

      for (const row of rows) {
        if (row.avatar || !row.phone) continue;
        const clubEmail = `club_phone_${row.phone}@purelyprofit.local`;
        const legacyEmail = `phone_${row.phone}@purelyprofit.local`;
        row.avatar =
          phoneAvatarMap.get(row.phone) ??
          emailAvatarMap.get(clubEmail) ??
          emailAvatarMap.get(legacyEmail) ??
          null;
      }
    }

    return {
      items: rows.map(mapCustomerRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    // B10: 先查询，再鉴权，统一返回 404，防止通过 403/404 区分存在性
    let customer = await queryCustomerRowById(this.prisma, customerId);
    if (customer) {
      try {
        await this.marketingSharedService.ensureMarketingStoreAccess(
          user,
          customer.storeId,
          'marketing:view',
        );
      } catch {
        // 无权限时抹掉 customer，统一返回 404，与不存在时一致，防止存在性探测
        customer = null;
      }
    }
    if (!customer) {
      throw new NotFoundException('顾客不存在');
    }

    // F8: 顾客详情短期缓存，避免高频重复聚合计算
    const detailCacheKey = buildMarketingCustomerDetailCacheKey(
      customer.storeId,
      customerId,
    );
    const cached =
      await this.redisService.getJson<MarketingCustomerDetailDto>(
        detailCacheKey,
      );
    if (cached) {
      return cached;
    }

    const [
      recentRecharges,
      recentConsumptions,
      rechargeSummary,
      refundSummary,
      consumptionPointsSummary,
      clubLevel,
    ] = await Promise.all([
      queryCustomerRecentRecharges(this.prisma, customerId, 5),
      queryCustomerRecentConsumptions(this.prisma, customerId, 5),
      this.prisma.marketingRecharge.aggregate({
        where: { customerId, type: 'recharge' },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: { customerId, type: 'refund' },
        _sum: { amount: true },
      }),
      this.prisma.marketingConsumption.aggregate({
        where: { customerId },
        _sum: { pointsDeducted: true },
      }),
      this.resolveClubLevel(customer.storeId, customer.phone),
    ]);

    // 累计充值本金（分）与累计退款本金（分）
    const totalRechargeCents = rechargeSummary._sum.amount ?? 0;
    const totalRefundCents = refundSummary._sum.amount ?? 0;
    // 赠送金额余额：基于时间线遍历，退款清零 + 充值重新累计
    const giftBalanceCents = await queryCustomerGiftBalanceCents(
      this.prisma,
      customerId,
    );
    // B2: 最大可退金额受当前实际余额约束
    // = min(累计充值本金 − 累计退款, 当前余额 − 赠送余额)
    const balanceCents = customer.balance;
    const principalRefundableCents = Math.max(
      0,
      totalRechargeCents - totalRefundCents,
    );
    const balanceConstrainedCents = Math.max(
      0,
      balanceCents - giftBalanceCents,
    );
    const refundableCents = Math.min(
      principalRefundableCents,
      balanceConstrainedCents,
    );
    const refundableAmount = Money.fromDbCents(refundableCents).toOutputYuan();
    const giftBalance = Money.fromDbCents(giftBalanceCents).toOutputYuan();
    // 积分抵扣总额（分）→ 元
    const totalPointsDeductedCents =
      consumptionPointsSummary._sum.pointsDeducted ?? 0;
    const totalPointsDeducted = Money.fromDbCents(
      totalPointsDeductedCents,
    ).toOutputYuan();

    const result = {
      ...mapCustomerRow(customer),
      ...clubLevel,
      // 累计充值本金（仅 type=recharge，不含赠送）
      totalRecharge: Money.fromDbCents(totalRechargeCents).toOutputYuan(),
      refundableAmount,
      giftBalance,
      totalPointsDeducted,
      recentRecharges: recentRecharges.map(mapRechargeRow),
      recentConsumptions: recentConsumptions.map(mapConsumptionRow),
    };

    // F8: 写入短期缓存
    await this.redisService.setJson(
      detailCacheKey,
      result,
      MARKETING_CUSTOMER_DETAIL_CACHE_TTL_SECONDS,
    );

    return result;
  }

  async createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    // D1: 区分「未填」(undefined/空串) 与「非法格式」，非法手机号应拒绝而非静默置 null
    const normalizedPhone = this.validatePhoneOrThrow(dto.phone);

    await this.ensureUniquePhone(storeId, normalizedPhone);

    try {
      const created = await this.prisma.marketingCustomer.create({
        data: {
          storeId,
          name: dto.name.trim(),
          phone: normalizedPhone,
          avatar: toNullableMediaText(dto.avatar),
          remark: dto.remark?.trim() || null,
          tier: 'regular',
        },
      });

      await this.invalidateOverviewCache(storeId);

      return mapCustomerRow(created);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('该手机号的顾客已存在');
      }
      throw error;
    }
  }

  async updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    if (dto.phone !== undefined) {
      // D1: 区分「空串=主动清除」与「非法格式=拒绝」
      const normalizedNewPhone = this.validatePhoneOrThrow(dto.phone);
      if (normalizedNewPhone !== normalizePhone(customer.phone)) {
        await this.ensureUniquePhone(
          customer.storeId,
          normalizedNewPhone,
          customerId,
        );
      }
    }

    // B8: 手机号变更时，同步更新关联的 Member.phone
    const phoneUpdate =
      dto.phone !== undefined
        ? { phone: this.validatePhoneOrThrow(dto.phone) }
        : {};

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.marketingCustomer.update({
          where: { id: customerId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...phoneUpdate,
            ...(dto.avatar !== undefined
              ? { avatar: toNullableMediaText(dto.avatar) }
              : {}),
            ...(dto.remark !== undefined
              ? { remark: dto.remark.trim() || null }
              : {}),
          },
        });

        // B8: 若手机号变更且有关联 Member，同步更新 Member.phone
        if (dto.phone !== undefined && customer.memberId !== null) {
          await tx.member.update({
            where: { id: customer.memberId },
            data: { phone: this.validatePhoneOrThrow(dto.phone) },
          });
        }

        return result;
      });

      await this.invalidateOverviewCache(customer.storeId);

      return mapCustomerRow(updated);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('该手机号的顾客已存在');
      }
      throw error;
    }
  }

  async deleteCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<void> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    if (
      Money.fromDbCents(customer.balance).isPositive() ||
      customer.points > 0
    ) {
      throw new BadRequestException(
        '该顾客仍有余额或积分，无法删除；请先完成退款或清零操作',
      );
    }

    // 软删除：更新 deletedAt 字段而非物理删除
    await this.prisma.marketingCustomer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });
    await this.invalidateOverviewCache(customer.storeId);
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      // F8: 同步失效顾客详情缓存
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  }

  private async resolveClubLevel(
    storeId: number,
    phone: string | null,
  ): Promise<Pick<MarketingCustomerDetailDto, 'clubLevel' | 'clubLevelLabel'>> {
    // B2: 防御性标准化，确保跨服务手机号格式一致
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return {};
    }

    try {
      const snapshot =
        await this.clubMemberProfileService.getSnapshotByStoreAndPhone(
          storeId,
          normalizedPhone,
        );
      if (!snapshot) {
        return {};
      }

      const currentLevelConfig =
        await this.clubMemberLevelsService.resolveCurrentLevelConfig(snapshot);

      return {
        clubLevel: currentLevelConfig.level as ClubMemberLevelValue,
        clubLevelLabel: currentLevelConfig.label,
      };
    } catch (err) {
      // B3: clubLevel 是附加字段，解析失败不应阻断核心数据返回
      this.logger.warn(
        `resolveClubLevel failed for storeId=${storeId}, phone=${normalizedPhone.slice(0, 3)}****: ${err instanceof Error ? err.message : err}`,
      );
      return {};
    }
  }

  private async ensureUniquePhone(
    storeId: number,
    phone: string | null | undefined,
    excludeCustomerId?: number,
  ): Promise<void> {
    const normalizedPhone = phone?.trim();
    if (!normalizedPhone) {
      return;
    }

    const existing = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone: normalizedPhone,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing && existing.id !== excludeCustomerId) {
      throw new ConflictException('该手机号的顾客已存在');
    }
  }

  /**
   * D1: 手机号校验——区分「未填/空串=清除」与「非法格式=400 拒绝」。
   * - undefined / '' → 返回 null（表示清除）
   * - 非空但 normalizePhone 返回 null → 抛 400
   * - 合法手机号 → 返回归一化后的手机号
   */
  private validatePhoneOrThrow(phone: string | undefined): string | null {
    if (phone === undefined || phone === '') {
      return null;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException('手机号格式不正确，请输入 11 位国内手机号');
    }
    return normalized;
  }

  async adjustCustomerPoints(
    user: AuthenticatedUser,
    customerId: number,
    dto: AdjustCustomerPointsDto,
  ): Promise<MarketingCustomerDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    // D2: 幂等保护，与 createRecharge 一致，5 秒内同参数请求视为重复提交
    const idempotencyKey = `adjust-points:dedup:${customer.storeId}:${customerId}:${dto.delta}:${dto.remark?.trim() || ''}`;
    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    // 事务前快速校验（提前拦截明显不合理的请求，避免无效事务开销）
    if (dto.delta < 0 && Math.abs(dto.delta) > customer.points) {
      throw new BadRequestException(
        `扣除积分不能超过当前余额（${customer.points}）`,
      );
    }

    const absDelta = Math.abs(dto.delta);
    const isDeduct = dto.delta < 0;

    // 使用事务确保所有操作原子性
    const updated = await this.prisma.$transaction(
      async (tx) => {
        // 1. 更新营销顾客积分（MarketingCustomer 是积分事实源）
        //    扣除时使用条件更新防止并发扣成负数
        let marketingUpdated;
        if (isDeduct) {
          const result = await tx.marketingCustomer.updateMany({
            where: { id: customerId, points: { gte: absDelta } },
            data: { points: { decrement: absDelta } },
          });
          if (result.count === 0) {
            throw new BadRequestException(
              '积分余额不足，扣除失败；请刷新后重试',
            );
          }
          marketingUpdated = await tx.marketingCustomer.findUniqueOrThrow({
            where: { id: customerId },
          });
        } else {
          marketingUpdated = await tx.marketingCustomer.update({
            where: { id: customerId },
            data: { points: { increment: dto.delta } },
          });
        }

        // 2. 创建营销积分流水记录
        await tx.marketingPointsRecord.create({
          data: {
            storeId: customer.storeId,
            customerId,
            amount: dto.delta,
            type: dto.delta > 0 ? 'gift' : 'spend',
            description:
              dto.remark || (dto.delta > 0 ? '后台调整积分' : '后台扣除积分'),
          },
        });

        // 3. 若有关联 Member，同步写 MemberPointsLog 流水（审计留档）
        //    注意：不再写 Member.points（废弃字段，MarketingCustomer 是唯一事实源）
        if (customer.memberId !== null) {
          const beforePoints = marketingUpdated.points - dto.delta;
          await tx.memberPointsLog.create({
            data: {
              memberId: customer.memberId,
              storeId: customer.storeId,
              changeType: dto.delta > 0 ? 'increase' : 'decrease',
              source: 'admin_adjust',
              changeAmount: absDelta,
              beforePoints,
              afterPoints: marketingUpdated.points,
              reason: '后台管理员调整',
              remark: dto.remark || null,
            },
          });
        }

        return marketingUpdated;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    await this.invalidateOverviewCache(customer.storeId);

    return mapCustomerRow(updated);
  }
}
