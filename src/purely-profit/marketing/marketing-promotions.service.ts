import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildMarketingPromotionsListCacheKey,
  buildMarketingPromotionsListPattern,
} from '../../redis/cache-keys';
import type {
  CreatePromotionDto,
  ListPromotionsQueryDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import type {
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
} from './dto/marketing-response.dto';
import { buildPromotionWhere } from './marketing.domain';
import { mapPromotionRow, normalizePromotionParams } from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
  type MarketingPromotionTypeValue,
} from './marketing.utils';
import { validatePromotionParams } from './schemas/promotion-params.schema';

const MARKETING_PROMOTIONS_LIST_CACHE_TTL_SECONDS = 60;
const MARKETING_PROMOTIONS_LIST_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class MarketingPromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listPromotions(
    user: AuthenticatedUser,
    query: ListPromotionsQueryDto,
  ): Promise<MarketingPromotionsResponseDto> {
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
    const cacheKey = buildMarketingPromotionsListCacheKey(
      resolvedStoreId,
      statusFilter,
      page,
      take,
    );

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_PROMOTIONS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_PROMOTIONS_LIST_REFRESH_AFTER_MS,
      loadValue: () =>
        this.queryPromotions(resolvedStoreId, statusFilter, skip, take, page),
    });
  }

  private async queryPromotions(
    resolvedStoreId: number,
    statusFilter: string,
    skip: number,
    take: number,
    page: number,
  ): Promise<MarketingPromotionsResponseDto> {
    const where = buildPromotionWhere({
      storeId: resolvedStoreId,
      status:
        statusFilter !== 'all'
          ? (statusFilter as 'upcoming' | 'active' | 'ended')
          : undefined,
    });

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
      items: rows.map((row) => mapPromotionRow(row)),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getPromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<MarketingPromotionDto> {
    const promotion =
      await this.marketingSharedService.findPromotionOrThrow(promotionId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
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
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );
    this.assertPromotionRange(new Date(dto.startAt), new Date(dto.endAt));
    await this.ensurePromotionTypeUnique(storeId, dto.type);

    const validatedParams = validatePromotionParams(dto.type, dto.params);
    const normalizedParams = normalizePromotionParams(
      validatedParams,
      dto.type,
    );
    const created = await this.prisma.marketingPromotion.create({
      data: {
        storeId,
        name: dto.name.trim(),
        type: dto.type as never,
        description: dto.description?.trim() ?? '',
        params: normalizedParams as Prisma.InputJsonValue,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        enabled: dto.enabled ?? true,
      },
    });

    await this.invalidateDashboardCaches(storeId);

    return mapPromotionRow(created);
  }

  async updatePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    const promotion =
      await this.marketingSharedService.findPromotionOrThrow(promotionId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      promotion.storeId,
      'marketing:manage',
    );

    const newStartAt =
      dto.startAt !== undefined ? new Date(dto.startAt) : promotion.startAt;
    const newEndAt =
      dto.endAt !== undefined ? new Date(dto.endAt) : promotion.endAt;
    this.assertPromotionRange(newStartAt, newEndAt);

    // 仅当启用上架时才检查同类型唯一性（避免已下架活动阻碍新建同类活动）
    const willBeEnabled = dto.enabled ?? promotion.enabled;
    if (willBeEnabled) {
      await this.ensurePromotionTypeUnique(
        promotion.storeId,
        promotion.type as MarketingPromotionTypeValue,
        promotionId,
      );
    }

    const updated = await this.prisma.marketingPromotion.update({
      where: { id: promotionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.params !== undefined
          ? {
              params: (() => {
                const validated = validatePromotionParams(
                  promotion.type,
                  dto.params,
                );
                return normalizePromotionParams(
                  validated,
                  promotion.type,
                ) as Prisma.InputJsonValue;
              })(),
            }
          : {}),
        ...(dto.startAt !== undefined ? { startAt: newStartAt } : {}),
        ...(dto.endAt !== undefined ? { endAt: newEndAt } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });

    await this.invalidateDashboardCaches(promotion.storeId);

    return mapPromotionRow(updated);
  }

  async deletePromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<void> {
    const promotion =
      await this.marketingSharedService.findPromotionOrThrow(promotionId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      promotion.storeId,
      'marketing:manage',
    );

    await this.prisma.marketingPromotion.delete({ where: { id: promotionId } });
    await this.invalidateDashboardCaches(promotion.storeId);
  }

  async togglePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    enabled: boolean,
  ): Promise<MarketingPromotionDto> {
    return this.updatePromotion(user, promotionId, { enabled });
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId),
      this.redisService.delByPattern(
        buildMarketingPromotionsListPattern(storeId),
      ),
    ]);
  }

  private async ensurePromotionTypeUnique(
    storeId: number,
    type: MarketingPromotionTypeValue,
    excludePromotionId?: number,
  ): Promise<void> {
    const duplicatedCount = await this.prisma.marketingPromotion.count({
      where: {
        storeId,
        type,
        enabled: true,
        ...(excludePromotionId !== undefined
          ? { id: { not: excludePromotionId } }
          : {}),
      },
    });

    if ((duplicatedCount ?? 0) > 0) {
      throw new ConflictException(
        '当前门店已存在相同类型的上架活动，请直接编辑现有活动',
      );
    }
  }

  private assertPromotionRange(startAt: Date, endAt: Date): void {
    if (endAt <= startAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }
  }
}
