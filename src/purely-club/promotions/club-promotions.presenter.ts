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
import type {
  ClubPromotionActionTypeValue,
  ClubPromotionDto,
} from './dto/club-promotion.dto';
import type { ClubPromotionRecord } from './club-promotions.types';

/** 首页活动列表最大返回条数 */
const CLUB_HOME_PROMOTION_LIMIT = 20;

/** 活动卡片的排序与操作按钮配置 */
interface ClubPromotionPresentation {
  priority: number;
  sort: number;
  actionText: string;
  actionType: ClubPromotionActionTypeValue;
  actionTarget: string;
}

/**
 * 把门店生效活动投影成 C 端首页优惠卡：白名单过滤 → 排序 → 截断。
 *
 * 展示条数上限必须在**排序之后**截断：此前用 DB `take: 20` 截的是
 * 「最近创建的 20 条」，而展示序由 sort/priority 决定，等于把最该
 * 展示的活动截掉了。排序键是类型常量映射，下推 SQL 需在 SQL 里复刻
 * 这张映射表，两处漂移的代价比多传几条记录大得多。
 */
export function buildClubPromotionItems(
  promotions: readonly ClubPromotionRecord[],
  now: Date,
): ClubPromotionDto[] {
  return (
    promotions
      .filter((promotion) => isSupportedPromotionType(promotion.type))
      // 签到入口由首页 Hero 独立承载；ClubPromotionDto.actionType 只有
      // view_products / open_recharge，签到活动若进入优惠卡会错误跳商品页。
      // 此处只排除「优惠活动卡」，不影响 isSupportedPromotionType 全量白名单。
      .filter((promotion) => !isDailyCheckInPromotion(promotion.type))
      .map((promotion) => toClubPromotion(promotion, now))
      .sort(
        (left, right) =>
          left.sort - right.sort ||
          right.priority - left.priority ||
          right.startAt - left.startAt,
      )
      .slice(0, CLUB_HOME_PROMOTION_LIMIT)
  );
}

function isSupportedPromotionType(
  type: string,
): type is ClubPromotionRecord['type'] {
  return MARKETING_PROMOTION_TYPE_VALUES.includes(
    type as MarketingPromotionTypeValue,
  );
}

/** 签到活动不是「优惠活动卡」，全量白名单仍保留该类型 */
function isDailyCheckInPromotion(type: string): boolean {
  return type === 'daily_check_in';
}

function toClubPromotion(
  promotion: ClubPromotionRecord,
  now: Date,
): ClubPromotionDto {
  const normalizedName = promotion.name?.trim() ?? '';
  const resolvedName = normalizedName || buildFallbackName(promotion.type);
  const normalizedDescription = promotion.description?.trim() ?? '';
  const rawParams = normalizePromotionParams(promotion.params, promotion.type);
  const presentation = resolvePresentation(promotion.type);
  const bannerImage = resolveBannerImage(rawParams);

  // 从 params 副本中移除展示层已提取的 bannerImage 相关字段，避免与顶层重复
  const params = stripBannerFields(rawParams);
  // 将 params 中的金额字段从分转为元，前端不再需要做 /100
  const paramsInYuan = convertParamsFenToYuan(params, promotion.type);

  return {
    id: String(promotion.id),
    name: resolvedName,
    type: promotion.type,
    description: normalizedDescription,
    benefitText: normalizedDescription || resolvedName,
    ...resolveDiscountFoldText(rawParams, promotion.type),
    params: paramsInYuan,
    startAt: promotion.startAt.getTime(),
    endAt: promotion.endAt.getTime(),
    statusText: buildStatusText(promotion.endAt, now),
    timeRangeText: buildTimeRangeText(promotion.startAt, promotion.endAt),
    priority: presentation.priority,
    sort: presentation.sort,
    ...(bannerImage ? { bannerImage } : {}),
    actionText: presentation.actionText,
    actionType: presentation.actionType,
    actionTarget: presentation.actionTarget,
  };
}

function resolvePresentation(
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
    // daily_check_in 已在 buildClubPromotionItems 被排除，不会走到 presentation；
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

function buildStatusText(endAt: Date, now: Date): string {
  const remainMs = endAt.getTime() - now.getTime();
  return remainMs <= 24 * 60 * 60 * 1000 ? '即将结束' : '进行中';
}

function buildTimeRangeText(startAt: Date, endAt: Date): string {
  return `${formatMonthDay(startAt)}-${formatMonthDay(endAt)}`;
}

function formatMonthDay(date: Date): string {
  return formatShanghaiDayLabel(date.getTime()).replace('/', '.');
}

function resolveBannerImage(
  params: MarketingPromotionParamsValue,
): string | undefined {
  const candidates = [
    params.bannerImage,
    params.image,
    readNestedString(params.banner, 'image'),
    readNestedString(params.banner, 'url'),
  ];

  return candidates
    .find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    )
    ?.trim();
}

/** 从 params 中移除已提取到顶层的 bannerImage 相关字段，返回裁剪后的副本 */
function stripBannerFields(
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
function convertParamsFenToYuan(
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

function readNestedString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const nestedValue = (value as Record<string, unknown>)[key];
  return typeof nestedValue === 'string' ? nestedValue : undefined;
}

function buildFallbackName(type: MarketingPromotionTypeValue): string {
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

function resolveDiscountFoldText(
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
