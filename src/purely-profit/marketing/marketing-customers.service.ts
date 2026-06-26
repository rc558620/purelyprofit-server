import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { ClubMemberLevelValue } from '../../purely-club/member/dto/club-member-account.dto';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildMarketingCustomersListCacheKey,
  buildMarketingCustomersListPattern,
} from '../../redis/cache-keys';
import { toNullableMediaText } from '../commerce/commerce.utils';
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
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from './marketing.utils';

const MARKETING_CUSTOMERS_LIST_CACHE_TTL_SECONDS = 60;
const MARKETING_CUSTOMERS_LIST_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class MarketingCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
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

    return this.redisService.getOrLoadRefreshableJson({
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
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const [recentRecharges, recentConsumptions, rechargeSummary, clubLevel] =
      await Promise.all([
        queryCustomerRecentRecharges(this.prisma, customerId, 5),
        queryCustomerRecentConsumptions(this.prisma, customerId, 5),
        this.prisma.marketingRecharge.aggregate({
          where: { customerId },
          _sum: { amount: true, giftAmount: true },
        }),
        this.resolveClubLevel(customer.storeId, customer.phone),
      ]);

    return {
      ...mapCustomerRow(customer),
      ...clubLevel,
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
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );
    await this.ensureUniquePhone(storeId, dto.phone);

    const created = await this.prisma.marketingCustomer.create({
      data: {
        storeId,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        avatar: toNullableMediaText(dto.avatar),
        remark: dto.remark?.trim() || null,
        tier: 'regular',
      },
    });

    await this.invalidateOverviewCache(storeId);

    return mapCustomerRow(created);
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

    if (dto.phone !== undefined && dto.phone !== customer.phone) {
      await this.ensureUniquePhone(customer.storeId, dto.phone, customerId);
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

    await this.invalidateOverviewCache(customer.storeId);

    return mapCustomerRow(updated);
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

    if (customer.balance > 0 || customer.points > 0) {
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
    const normalizedPhone = phone?.trim();
    if (!normalizedPhone) {
      return {};
    }

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
  }

  private async ensureUniquePhone(
    storeId: number,
    phone: string | undefined,
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
    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. 更新营销顾客积分（MarketingCustomer 是积分事实源）
      //    扣除时使用条件更新防止并发扣成负数
      let marketingUpdated;
      if (isDeduct) {
        const result = await tx.marketingCustomer.updateMany({
          where: { id: customerId, points: { gte: absDelta } },
          data: { points: { decrement: absDelta } },
        });
        if (result.count === 0) {
          throw new BadRequestException('积分余额不足，扣除失败；请刷新后重试');
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
    });

    await this.invalidateOverviewCache(customer.storeId);

    return mapCustomerRow(updated);
  }
}
