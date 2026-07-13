import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, type MarketingPromotionType } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
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
import {
  buildPromotionDisplayText,
  mapPromotionParamsForWrite,
  mapPromotionRow,
  normalizePromotionParams,
} from './marketing.mapper';
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
    private readonly refreshableCache: RefreshableCacheService,
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
    // POTENTIAL-2 修复：无门店权限时保留请求页码，避免 meta.page 被强制改为 1
    if (!resolvedStoreId) {
      const { page, take } = resolveMarketingPagination(
        query.page,
        query.pageSize,
      );
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, page, take),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const statusFilter = query.status ?? 'all';
    const enabledFilter = query.enabled;

    // POTENTIAL-3 修复：活动状态由「当前时间」计算（非持久化字段）。
    // 按具体状态过滤的结果在缓存窗口内会因时间自然流转而过期（最多 TTL 秒），
    // 故仅 status='all' 走缓存，带具体状态过滤时直接查库保证实时。
    if (statusFilter !== 'all') {
      return this.queryPromotions(
        resolvedStoreId,
        statusFilter,
        enabledFilter,
        skip,
        take,
        page,
      );
    }

    const cacheKey = buildMarketingPromotionsListCacheKey(
      resolvedStoreId,
      statusFilter,
      page,
      take,
      enabledFilter,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_PROMOTIONS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_PROMOTIONS_LIST_REFRESH_AFTER_MS,
      loadValue: () =>
        this.queryPromotions(
          resolvedStoreId,
          statusFilter,
          enabledFilter,
          skip,
          take,
          page,
        ),
    });
  }

  private async queryPromotions(
    resolvedStoreId: number,
    statusFilter: string,
    enabledFilter: boolean | undefined,
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
      enabled: enabledFilter,
    });

    const [rows, total] = await Promise.all([
      this.prisma.marketingPromotion.findMany({
        where,
        select: {
          id: true,
          storeId: true,
          name: true,
          type: true,
          description: true,
          params: true,
          startAt: true,
          endAt: true,
          usageCount: true,
          totalDiscount: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
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

    // POTENTIAL-5 修复：先校验参数，再做唯一性查询，
    // 避免无效参数时多余的 count 查询且错误提示顺序颠倒
    const validatedParams = validatePromotionParams(dto.type, dto.params);
    const normalizedParams = normalizePromotionParams(
      validatedParams,
      dto.type,
    );

    const willBeEnabled = dto.enabled ?? true;
    if (willBeEnabled) {
      await this.ensurePromotionTypeUnique(storeId, dto.type);
    }

    // 前端入参（元）→ DB 存储（分）
    const writeParams = mapPromotionParamsForWrite(normalizedParams, dto.type);
    // BUG-1 修复：normalizedParams 已是「元」，应直接用于展示文案计算；
    // 此前误用 mapPromotionParamsForOutput（语义为分→元）导致 reduce/recharge_gift
    // 文案被缩小 100 倍入库（如 "满 ¥0.5 减 ¥0.08"）。读路径 mapPromotionRow 对
    // 分存储的 row.params 使用该函数是正确用法，写路径不可复用。
    const displayText =
      buildPromotionDisplayText(dto.type, normalizedParams) || null;
    let created;
    try {
      created = await this.prisma.marketingPromotion.create({
        data: {
          storeId,
          name: dto.name.trim(),
          type: dto.type as unknown as MarketingPromotionType,
          description: dto.description?.trim() ?? '',
          params: writeParams as Prisma.InputJsonValue,
          displayText,
          startAt: new Date(dto.startAt),
          endAt: new Date(dto.endAt),
          enabled: dto.enabled ?? true,
        },
      });
    } catch (err) {
      // 并发场景下应用层 count=0 通过，但 DB 唯一索引冲突 P2002
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          '当前门店已存在相同类型的上架活动，请直接编辑现有活动',
        );
      }
      throw err;
    }

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
    // B9：仅当修改时间字段时才校验时间范围
    // （允许已结束活动编辑 name/description/enabled 等无害字段）
    const timeFieldChanged =
      dto.startAt !== undefined || dto.endAt !== undefined;
    if (timeFieldChanged) {
      this.assertPromotionRange(newStartAt, newEndAt);
    }

    // POTENTIAL-5 修复：先校验参数，再做唯一性查询
    const validatedParams =
      dto.params !== undefined
        ? validatePromotionParams(promotion.type, dto.params)
        : undefined;
    const normalizedParams =
      validatedParams !== undefined
        ? normalizePromotionParams(validatedParams, promotion.type)
        : undefined;

    // 仅当启用上架时才检查同类型唯一性（避免已下架活动阻碍新建同类活动）
    const willBeEnabled = dto.enabled ?? promotion.enabled;
    if (willBeEnabled) {
      await this.ensurePromotionTypeUnique(
        promotion.storeId,
        promotion.type as MarketingPromotionTypeValue,
        promotionId,
      );
    }

    // B1：与 togglePromotion 保持一致——显式上架已结束的活动时拦截
    if (dto.enabled === true && newEndAt < new Date()) {
      throw new BadRequestException('不能上架已结束的活动');
    }

    let updated;
    try {
      updated = await this.prisma.marketingPromotion.update({
        where: { id: promotionId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() }
            : {}),
          ...(normalizedParams !== undefined
            ? {
                // 前端入参（元）→ DB 存储（分）
                params: mapPromotionParamsForWrite(
                  normalizedParams,
                  promotion.type,
                ) as Prisma.InputJsonValue,
                // BUG-1 修复：normalizedParams 已是「元」，直接用于展示文案
                displayText:
                  buildPromotionDisplayText(promotion.type, normalizedParams) ||
                  null,
              }
            : {}),
          ...(dto.startAt !== undefined ? { startAt: newStartAt } : {}),
          ...(dto.endAt !== undefined ? { endAt: newEndAt } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        },
      });
    } catch (err) {
      // 并发场景下 update 切换 enabled=true 触发 P2002
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          '当前门店已存在相同类型的上架活动，请直接编辑现有活动',
        );
      }
      throw err;
    }

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
    // B7：上架时校验活动是否已结束，防止启用过期活动
    if (enabled) {
      const promotion =
        await this.marketingSharedService.findPromotionOrThrow(promotionId);
      if (promotion.endAt < new Date()) {
        throw new BadRequestException('不能上架已结束的活动');
      }
    }
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
    // B10：禁止创建/编辑已结束的活动
    if (endAt < new Date()) {
      throw new BadRequestException('活动结束时间不能早于当前时间');
    }
  }
}
