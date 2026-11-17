import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
import { formatShanghaiDayLabel } from '../../shared/shanghai-time.utils';
import { normalizePromotionParams } from '../../purely-profit/marketing/marketing.mapper';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionParamValue,
  type MarketingPromotionParamsValue,
  type MarketingPromotionTypeValue,
} from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisReadPrefetchService } from '../../redis/redis-read-prefetch.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubPromotionListCacheKey } from '../../redis/keys/club-cache-keys';
import {
  resolveClubPromotionCacheTtlSeconds,
  runClubPromotionSingleflight,
} from '../shared/club-promotion-cache.helper';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubPromotionActionTypeValue,
  ClubPromotionDto,
  ClubPromotionsResponseDto,
} from './dto/club-promotion.dto';
import {
  clubPromotionSelect,
  type ClubPromotionRecord,
} from './club-promotions.types';

/** 首页活动列表最大返回条数 */
const CLUB_HOME_PROMOTION_LIMIT = 20;

/**
 * 缓存中的活动记录形状：Date 字段经 JSON 序列化后是 ISO 字符串，
 * 读取时必须还原成 Date——直接 cast 回 ClubPromotionRecord 会让
 * startAt.getTime() 之类的调用在运行时崩掉。
 */
type CachedClubPromotionRecord = Omit<
  ClubPromotionRecord,
  'startAt' | 'endAt' | 'createdAt'
> & {
  startAt: string;
  endAt: string;
  createdAt: string;
};

interface ClubPromotionPresentation {
  priority: number;
  sort: number;
  actionText: string;
  actionType: ClubPromotionActionTypeValue;
  actionTarget: string;
}

@Injectable()
export class ClubPromotionsService {
  private readonly logger = new Logger(ClubPromotionsService.name);
  /** 缓存未命中时的进程内并发去重 */
  private readonly inflightLoads = new Map<
    string,
    Promise<ClubPromotionRecord[]>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly redisReadPrefetch: RedisReadPrefetchService,
  ) {}

  async list(
    currentContext: ClubCurrentContext,
  ): Promise<ClubPromotionsResponseDto> {
    const now = new Date();
    const promotions = await this.loadActivePromotions(
      currentContext.store.id,
      now,
    );

    return {
      items: promotions
        .filter((promotion): promotion is ClubPromotionRecord =>
          this.isSupportedPromotionType(promotion.type),
        )
        // 签到入口由首页 Hero 独立承载；ClubPromotionDto.actionType 只有
        // view_products / open_recharge，签到活动若进入优惠卡会错误跳商品页。
        // 此处只排除「优惠活动卡」，不影响 isSupportedPromotionType 全量白名单。
        .filter((promotion) => !this.isDailyCheckInPromotion(promotion.type))
        .map((promotion) => this.toClubPromotion(promotion, now))
        .sort(
          (left, right) =>
            left.sort - right.sort ||
            right.priority - left.priority ||
            right.startAt - left.startAt,
        )
        // 展示条数上限必须在**排序之后**截断：此前用 DB `take: 20` 截的是
        // 「最近创建的 20 条」，而展示序由 sort/priority 决定，等于把最该
        // 展示的活动截掉了。排序键是类型常量映射，下推 SQL 需在 SQL 里复刻
        // 这张映射表，两处漂移的代价比多传几条记录大得多。
        .slice(0, CLUB_HOME_PROMOTION_LIMIT),
    };
  }

  /**
   * 读取当前门店生效活动（展示口径），优先走门店级缓存。
   *
   * 首页与活动页每次进入都会调 list，而活动只在后台改配置时变化，
   * 未缓存时每个 C 端页面进入都要跑一次 marketingPromotion 查询。
   *
   * 缓存口径：
   *  - TTL 由最近的活动边界决定（见 resolveClubPromotionCacheTtlSeconds），
   *    保证未开始活动到点即出现、已结束活动到点即消失；
   *  - 无 take：缓存全量「未结束 + 启用 + 白名单类型」活动，展示上限在排序后
   *    截断。窗口过滤已排除历史活动，正常门店只有几条到几十条；
   *  - 空数组同样缓存；
   *  - Redis 异常降级回源，缓存不许变成故障点。
   *
   * 【已评估：不下推 ORDER BY / LIMIT】单店行数有业务硬上界——`ensurePromotionTypeUnique`
   * 强制 `(storeId, type, enabled=true)` 唯一，白名单 9 种类型 → 每店 ≤9 行
   * （本地真实库实测窗口内 5–6 行，avg 5.67，max 6）。下推只能省 ≤9 行传输与一次
   * ≤9 元素 sort（<0.1ms），却要在 SQL 复刻 resolvePresentation 的 (sort, priority)
   * 常量映射；漂移代价远高于收益，故维持现状。
   * 复测：`SELECT store_id, count(*) FROM marketing_promotions WHERE enabled AND
   * end_at >= now() GROUP BY 1 ORDER BY 2 DESC LIMIT 20;` 出现单店 >50 行（唯一
   * 约束被绕过）时再重新评估下推。
   */
  private async loadActivePromotions(
    storeId: number,
    now: Date,
  ): Promise<ClubPromotionRecord[]> {
    const cacheKey = buildClubPromotionListCacheKey(storeId);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached.map((record) => this.revivePromotionRecord(record));
    }

    return runClubPromotionSingleflight(this.inflightLoads, cacheKey, () =>
      this.loadFromDatabase(storeId, cacheKey, now),
    );
  }

  private async loadFromDatabase(
    storeId: number,
    cacheKey: string,
    now: Date,
  ): Promise<ClubPromotionRecord[]> {
    // 只按 endAt 过滤：未开始的活动也要取回来，它决定缓存的「开始」边界
    const rows = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: { in: [...MARKETING_PROMOTION_TYPE_VALUES] },
        endAt: { gte: now },
      },
      select: clubPromotionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const active = rows.filter((row) => row.startAt.getTime() <= now.getTime());

    await this.writeCache(
      cacheKey,
      active,
      resolveClubPromotionCacheTtlSeconds(rows, now.getTime()),
    );

    return active;
  }

  /**
   * 读缓存：异常降级为「未命中」，不阻断首页/活动页。
   *
   * 首页聚合已用一次 MGET 预取本 key，命中即省掉本次往返；未预取时回退单条 GET。
   */
  private async readCache(
    cacheKey: string,
  ): Promise<CachedClubPromotionRecord[] | null> {
    const prefetched =
      await this.redisReadPrefetch.peekJson<CachedClubPromotionRecord[]>(
        cacheKey,
      );
    if (prefetched !== undefined) {
      return prefetched;
    }

    try {
      return await this.redisService.getJson<CachedClubPromotionRecord[]>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `读取活动列表缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  /** 写缓存：失败只影响下次是否命中，不改变本次结果。 */
  private async writeCache(
    cacheKey: string,
    records: ClubPromotionRecord[],
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.setJson(cacheKey, records, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `写入活动列表缓存失败 cacheKey=${cacheKey} ttl=${ttlSeconds}s: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** 把缓存里被 JSON 序列化成 ISO 字符串的日期字段还原为 Date */
  private revivePromotionRecord(
    record: CachedClubPromotionRecord,
  ): ClubPromotionRecord {
    return {
      ...record,
      startAt: new Date(record.startAt),
      endAt: new Date(record.endAt),
      createdAt: new Date(record.createdAt),
    };
  }

  private isSupportedPromotionType(
    type: string,
  ): type is ClubPromotionRecord['type'] {
    return MARKETING_PROMOTION_TYPE_VALUES.includes(
      type as MarketingPromotionTypeValue,
    );
  }

  /** 签到活动不是「优惠活动卡」，全量白名单仍保留该类型 */
  private isDailyCheckInPromotion(type: string): boolean {
    return type === 'daily_check_in';
  }

  private toClubPromotion(
    promotion: ClubPromotionRecord,
    now: Date,
  ): ClubPromotionDto {
    const normalizedName = promotion.name?.trim() ?? '';
    const resolvedName =
      normalizedName || this.buildFallbackName(promotion.type);
    const normalizedDescription = promotion.description?.trim() ?? '';
    const rawParams = normalizePromotionParams(
      promotion.params,
      promotion.type,
    );
    const presentation = this.resolvePresentation(promotion.type);
    const bannerImage = this.resolveBannerImage(rawParams);

    // 从 params 副本中移除展示层已提取的 bannerImage 相关字段，避免与顶层重复
    const params = this.stripBannerFields(rawParams);
    // 将 params 中的金额字段从分转为元，前端不再需要做 /100
    const paramsInYuan = this.convertParamsFenToYuan(params, promotion.type);

    return {
      id: String(promotion.id),
      name: resolvedName,
      type: promotion.type,
      description: normalizedDescription,
      benefitText: normalizedDescription || resolvedName,
      ...this.resolveDiscountFoldText(rawParams, promotion.type),
      params: paramsInYuan,
      startAt: promotion.startAt.getTime(),
      endAt: promotion.endAt.getTime(),
      statusText: this.buildStatusText(promotion.endAt, now),
      timeRangeText: this.buildTimeRangeText(
        promotion.startAt,
        promotion.endAt,
      ),
      priority: presentation.priority,
      sort: presentation.sort,
      ...(bannerImage ? { bannerImage } : {}),
      actionText: presentation.actionText,
      actionType: presentation.actionType,
      actionTarget: presentation.actionTarget,
    };
  }

  private resolvePresentation(
    type: MarketingPromotionTypeValue,
  ): ClubPromotionPresentation {
    switch (type) {
      case 'first_order_discount':
        return {
          priority: 100,
          sort: 10,
          actionText: '去下单',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'recharge_gift':
        return {
          priority: 90,
          sort: 20,
          actionText: '去充值',
          actionType: 'open_recharge',
          actionTarget: 'club_recharge_packages',
        };
      case 'reduce':
        return {
          priority: 80,
          sort: 30,
          actionText: '去使用',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'discount':
        return {
          priority: 70,
          sort: 40,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'free':
        return {
          priority: 60,
          sort: 50,
          actionText: '了解详情',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'points_2x':
        return {
          priority: 50,
          sort: 60,
          actionText: '去消费',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'points_recharge':
        return {
          priority: 45,
          sort: 65,
          actionText: '去消费',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'discount_day':
        return {
          priority: 85,
          sort: 15,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      // daily_check_in 已在 list() 被排除，不会走到 presentation；
      // 若未来要展示签到卡，需新增 actionType 'open_check_in' 并跨端确认后再改。
      default:
        return {
          priority: 40,
          sort: 70,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
    }
  }

  private buildStatusText(endAt: Date, now: Date): string {
    const remainMs = endAt.getTime() - now.getTime();
    return remainMs <= 24 * 60 * 60 * 1000 ? '即将结束' : '进行中';
  }

  private buildTimeRangeText(startAt: Date, endAt: Date): string {
    return `${this.formatMonthDay(startAt)}-${this.formatMonthDay(endAt)}`;
  }

  private formatMonthDay(date: Date): string {
    return formatShanghaiDayLabel(date.getTime()).replace('/', '.');
  }

  private resolveBannerImage(
    params: MarketingPromotionParamsValue,
  ): string | undefined {
    const candidates = [
      params.bannerImage,
      params.image,
      this.readNestedString(params.banner, 'image'),
      this.readNestedString(params.banner, 'url'),
    ];

    return candidates
      .find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0,
      )
      ?.trim();
  }

  /** 从 params 中移除已提取到顶层的 bannerImage 相关字段，返回裁剪后的副本 */
  private stripBannerFields(
    params: MarketingPromotionParamsValue,
  ): MarketingPromotionParamsValue {
    const cleaned = { ...params };
    delete cleaned.bannerImage;
    delete cleaned.image;
    delete cleaned.banner;
    return cleaned;
  }

  /**
   * 将活动 params 中的金额字段从分转为元。
   * 根据活动类型识别需要转换的字段，使用 Money.fromDbCents().toOutputYuan() 保证精度。
   */
  private convertParamsFenToYuan(
    params: MarketingPromotionParamsValue,
    type: MarketingPromotionTypeValue,
  ): MarketingPromotionParamsValue {
    const result = { ...params };

    switch (type) {
      case 'reduce':
        if (typeof result.threshold === 'number') {
          result.threshold = Money.fromDbCents(result.threshold).toOutputYuan();
        }
        if (typeof result.reduceAmount === 'number') {
          result.reduceAmount = Money.fromDbCents(
            result.reduceAmount,
          ).toOutputYuan();
        }
        break;

      case 'recharge_gift':
        if (Array.isArray(result.gradients)) {
          result.gradients = result.gradients.map(
            (gradient: MarketingPromotionParamsValue) => {
              if (
                !gradient ||
                typeof gradient !== 'object' ||
                Array.isArray(gradient)
              ) {
                return gradient;
              }
              const g = {
                ...(gradient as Record<string, MarketingPromotionParamValue>),
              };
              if (typeof g.rechargeAmount === 'number') {
                g.rechargeAmount = Money.fromDbCents(
                  g.rechargeAmount,
                ).toOutputYuan();
              }
              if (typeof g.giftAmount === 'number') {
                g.giftAmount = Money.fromDbCents(g.giftAmount).toOutputYuan();
              }
              return g;
            },
          );
        }
        break;

      case 'points_recharge':
        // points_recharge 的 rechargeAmount 可能也是分
        if (typeof result.rechargeAmount === 'number') {
          result.rechargeAmount = Money.fromDbCents(
            result.rechargeAmount,
          ).toOutputYuan();
        }
        break;

      default:
        // discount / first_order_discount / discount_day / free / points_2x
        // 这些类型的 params 中没有金额字段，不需要转换
        break;
    }

    return result;
  }

  private readNestedString(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const nestedValue = (value as Record<string, unknown>)[key];
    return typeof nestedValue === 'string' ? nestedValue : undefined;
  }

  private buildFallbackName(type: MarketingPromotionTypeValue): string {
    switch (type) {
      case 'discount':
        return '折扣优惠';
      case 'reduce':
        return '满减优惠';
      case 'recharge_gift':
        return '充值赠送';
      case 'first_order_discount':
        return '首单优惠';
      case 'free':
        return '免费体验';
      case 'points_2x':
        return '双倍积分';
      case 'points_recharge':
        return '积分抵现';
      case 'discount_day':
        return '折扣日';
      case 'daily_check_in':
        return '每日签到';
      default:
        return '限时优惠';
    }
  }

  private resolveDiscountFoldText(
    params: MarketingPromotionParamsValue,
    type: MarketingPromotionTypeValue,
  ): { discountFoldText?: string } {
    const discountTypes: MarketingPromotionTypeValue[] = [
      'discount',
      'first_order_discount',
      'discount_day',
    ];
    if (!discountTypes.includes(type)) {
      return {};
    }

    const rawRate =
      typeof params.discountRate === 'number'
        ? params.discountRate
        : typeof params.rate === 'number'
          ? params.rate * 100
          : undefined;

    if (rawRate === undefined || rawRate <= 0 || rawRate > 100) {
      return {};
    }

    const foldValue = new Decimal(rawRate).div(10).toDecimalPlaces(1);
    const normalized = foldValue.isInteger()
      ? foldValue.toFixed(0)
      : foldValue.toFixed(1);

    return { discountFoldText: normalized };
  }
}
