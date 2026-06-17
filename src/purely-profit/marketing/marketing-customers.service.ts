import {
  ConflictException,
  forwardRef,
  Inject,
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
    @Inject(forwardRef(() => RedisService))
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto & { storeId?: number },
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
    const cacheKey = buildMarketingCustomersListCacheKey(
      resolvedStoreId,
      statusFilter,
      tierFilter,
      keywordFilter,
      page,
      take,
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
          ? (tierFilter as 'regular' | 'silver' | 'gold' | 'diamond')
          : undefined,
      keyword: keywordFilter || undefined,
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

    await this.prisma.marketingCustomer.delete({ where: { id: customerId } });
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

    const existing = await this.prisma.marketingCustomer.findUnique({
      where: { storeId_phone: { storeId, phone: normalizedPhone } },
      select: { id: true },
    });
    if (existing && existing.id !== excludeCustomerId) {
      throw new ConflictException('该手机号的顾客已存在');
    }
  }
}
