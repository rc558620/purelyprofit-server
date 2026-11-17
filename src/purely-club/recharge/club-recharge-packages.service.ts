import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubRechargePackagesCacheKey } from '../../redis/keys/club-cache-keys';
import { runClubPromotionSingleflight } from '../shared/club-promotion-cache.helper';
import { CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS } from './club-recharge.constants';
import type { ClubRechargePackageDto } from './dto/club-recharge.dto';
import {
  type ClubRechargePromotionParams,
  type ClubRechargePromotionRecord,
  DEFAULT_CLUB_RECHARGE_PACKAGES,
} from './club-recharge.types';
import {
  Money,
  toNonNegativeInteger,
  toNonNegativeNumber,
  toPositiveInteger,
} from './club-recharge.utils';

/**
 * 门店充值套餐（`marketing_promotions` 投影）。
 *
 * 缓存策略与 ClubPromotionRepository 同范式：
 *  - 门店粒度 60s 兜底 TTL（`CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS`）；
 *  - **空结果同样缓存**：无充赠活动的门店返回默认套餐，这份默认列表本身有效，
 *    不缓存的话每次进充值页都要回源营销活动表；
 *  - 进程内单飞去重，避免首屏并发把同一条查询放大；
 *  - Redis 读写异常一律降级回源（充值页不能因为缓存故障打不开）。
 * 失效挂在既有的 `invalidateMarketingOverview` 上，与两份 C 端活动缓存成对删除。
 */
@Injectable()
export class ClubRechargePackagesService {
  private readonly logger = new Logger(ClubRechargePackagesService.name);
  /** 缓存未命中时的进程内并发去重 */
  private readonly inflightLoads = new Map<
    string,
    Promise<ClubRechargePackageDto[]>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 加载门店充值套餐列表
   * 优先从营销活动加载，无活动时返回默认套餐
   */
  async loadPackagesForStore(
    storeId: number,
  ): Promise<ClubRechargePackageDto[]> {
    const cacheKey = buildClubRechargePackagesCacheKey(storeId);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    return runClubPromotionSingleflight(this.inflightLoads, cacheKey, () =>
      this.loadFromDatabase(storeId, cacheKey),
    );
  }

  /** 回源营销活动并回写缓存；返回的数组与缓存里的是同一份口径 */
  private async loadFromDatabase(
    storeId: number,
    cacheKey: string,
  ): Promise<ClubRechargePackageDto[]> {
    const now = new Date();
    const promotions = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: 'recharge_gift',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: {
        id: true,
        name: true,
        description: true,
        params: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const mappedPackages = promotions.flatMap((promotion) =>
      this.toRechargePackages(promotion),
    );

    const packages =
      mappedPackages.length > 0
        ? this.markRecommendedPackage(mappedPackages)
        : this.cloneDefaultPackages();

    await this.writeCache(cacheKey, packages);
    return packages;
  }

  /** 读缓存：异常降级为「未命中」，不阻断充值页 */
  private async readCache(
    cacheKey: string,
  ): Promise<ClubRechargePackageDto[] | null> {
    try {
      return await this.redisService.getJson<ClubRechargePackageDto[]>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `读取充值套餐缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  /** 写缓存：失败只影响下次是否命中，不改变本次结果 */
  private async writeCache(
    cacheKey: string,
    packages: ClubRechargePackageDto[],
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        packages,
        CLUB_RECHARGE_PACKAGES_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `写入充值套餐缓存失败 cacheKey=${cacheKey}: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * 将营销活动转换为充值套餐
   */
  private toRechargePackages(
    promotion: ClubRechargePromotionRecord,
  ): ClubRechargePackageDto[] {
    const paramsList = this.normalizePromotionParams(promotion.params);
    if (paramsList.length === 0) {
      return [];
    }

    const normalizedName = promotion.name.trim();
    const normalizedDescription = promotion.description.trim();
    const tag = normalizedDescription || normalizedName || undefined;

    return paramsList.map((params, index) => ({
      id: this.buildPackageId(promotion.id, index, paramsList.length),
      amount: Money.fromDbCents(params.rechargeAmountFen).toOutputYuan(),
      bonusAmount: Money.fromDbCents(params.giftAmountFen).toOutputYuan(),
      ...(tag ? { tag } : {}),
      recommended: false,
    }));
  }

  /**
   * 标准化营销活动参数
   */
  private normalizePromotionParams(
    raw: unknown,
  ): ClubRechargePromotionParams[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Partial<Record<string, unknown>>;
    const gradients =
      (Array.isArray(candidate.gradients) ? candidate.gradients : undefined) ??
      (Array.isArray(candidate.tiers) ? candidate.tiers : undefined);

    if (gradients) {
      return gradients
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object' && !Array.isArray(item),
        )
        .map((item) => this.normalizePromotionGradient(item))
        .filter((item): item is ClubRechargePromotionParams => item !== null);
    }

    const legacyGradient = this.normalizePromotionGradient(candidate);
    return legacyGradient ? [legacyGradient] : [];
  }

  private normalizePromotionGradient(
    raw: unknown,
  ): ClubRechargePromotionParams | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const candidate = raw as Partial<Record<string, unknown>>;
    const rechargeAmountFen = toPositiveInteger(
      candidate.rechargeAmount ?? candidate.threshold,
    );
    if (!rechargeAmountFen) {
      return null;
    }

    const giftAmountFen = this.resolveGiftAmountFen(
      candidate,
      rechargeAmountFen,
    );
    if (giftAmountFen < 0) {
      return null;
    }

    return {
      rechargeAmountFen,
      giftAmountFen,
    };
  }

  /**
   * 解析赠送金额
   */
  private resolveGiftAmountFen(
    candidate: Partial<Record<string, unknown>>,
    rechargeAmountFen: number,
  ): number {
    const explicitGiftAmount = toNonNegativeInteger(candidate.giftAmount);
    if (explicitGiftAmount !== null) {
      return explicitGiftAmount;
    }

    const giftRatio = toNonNegativeNumber(candidate.giftRatio);
    if (giftRatio !== null) {
      return new Decimal(rechargeAmountFen)
        .mul(giftRatio)
        .toDecimalPlaces(0)
        .toNumber();
    }

    return 0;
  }

  private buildPackageId(
    promotionId: number,
    gradientIndex: number,
    gradientCount: number,
  ): string {
    if (gradientCount <= 1) {
      return String(promotionId);
    }

    return `${promotionId}:${gradientIndex}`;
  }

  /**
   * 标记推荐套餐（赠金最多，同赠金时金额最大）
   */
  private markRecommendedPackage(
    packages: ClubRechargePackageDto[],
  ): ClubRechargePackageDto[] {
    let bestId: string | null = null;
    let bestBonusAmount = -1;
    let bestAmount = -1;

    for (const currentPackage of packages) {
      if (
        currentPackage.bonusAmount > bestBonusAmount ||
        (currentPackage.bonusAmount === bestBonusAmount &&
          currentPackage.amount > bestAmount)
      ) {
        bestId = currentPackage.id;
        bestBonusAmount = currentPackage.bonusAmount;
        bestAmount = currentPackage.amount;
      }
    }

    return packages.map((item) => ({
      ...item,
      recommended: item.id === bestId,
    }));
  }

  /**
   * 克隆默认套餐
   */
  private cloneDefaultPackages(): ClubRechargePackageDto[] {
    return DEFAULT_CLUB_RECHARGE_PACKAGES.map((item) => ({ ...item }));
  }
}
