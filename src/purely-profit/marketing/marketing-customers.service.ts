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

    return {
      items: rows.map(mapCustomerRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    // B6: 先查询（不抛异常），再鉴权，最后统一返回 404，防止存在性探测
    const customer = await queryCustomerRowById(this.prisma, customerId);
    if (customer) {
      await this.marketingSharedService.ensureMarketingStoreAccess(
        user,
        customer.storeId,
        'marketing:view',
      );
    }
    if (!customer) {
      throw new NotFoundException('顾客不存在');
    }

    const [recentRecharges, recentConsumptions, rechargeSummary, clubLevel] =
      await Promise.all([
        queryCustomerRecentRecharges(this.prisma, customerId, 5),
        queryCustomerRecentConsumptions(this.prisma, customerId, 5),
        this.prisma.marketingRecharge.aggregate({
          where: { customerId, type: 'recharge' },
          _sum: { amount: true },
        }),
        this.resolveClubLevel(customer.storeId, customer.phone),
      ]);

    return {
      ...mapCustomerRow(customer),
      ...clubLevel,
      // 累计充值 = 实际充值金额（不含赠送）汇总
      totalRecharge: Money.fromDbCents(
        rechargeSummary._sum.amount ?? 0,
      ).toOutputYuan(),
      recentRecharges: recentRecharges.map(mapRechargeRow),
      recentConsumptions: recentConsumptions.map(mapConsumptionRow),
    };
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
    const normalizedPhone = normalizePhone(dto.phone);
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
      const normalizedNewPhone = normalizePhone(dto.phone);
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
      dto.phone !== undefined ? { phone: normalizePhone(dto.phone) } : {};

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
            data: { phone: normalizePhone(dto.phone) },
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
