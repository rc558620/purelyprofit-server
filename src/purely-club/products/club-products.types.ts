/** 热销商品数量（临时占位：当前取最新创建的前 N 个，后续应改为按实际销量排序） */
export const CLUB_HOT_PRODUCT_COUNT = 3;
export const CLUB_FEATURED_PRODUCT_LIMIT = 6;
/** 列表接口默认返回上限，防止全量加载 */
export const CLUB_PRODUCT_DEFAULT_LIST_LIMIT = 50;
export { CLUB_PRODUCT_NOT_FOUND_MESSAGE } from '../club-errors.constants';

export const clubProductSelect = {
  id: true,
  categoryId: true,
  name: true,
  price: true,
  originalPrice: true,
  image: true,
  descriptionTitle: true,
  description: true,
  stock: true,
  durationMinutes: true,
  personCount: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      name: true,
    },
  },
} as const;

export interface ClubProductRecord {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  descriptionTitle: string | null;
  description: string | null;
  stock: number;
  durationMinutes: number | null;
  personCount: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: {
    name: string;
  } | null;
}

export interface ClubProductDiscountPromotion {
  id: number;
  discountRate: number;
  tag: string;
}

export interface ClubProductReducePromotion {
  id: number;
  thresholdFen: number;
  reduceAmountFen: number;
  tag: string;
}

export interface ClubProductPricingContext {
  memberDiscountRate: number | null;
  /** 当前用户是否为首单买家（consumptionCount === 0）；用于在视图层显式拦截首单折扣 */
  isFirstOrderBuyer: boolean;
  firstOrderPromotions: ClubProductDiscountPromotion[];
  discountPromotions: ClubProductDiscountPromotion[];
  reducePromotions: ClubProductReducePromotion[];
}

/** 已应用的优惠活动摘要（返回给前端展示） */
export interface ClubAppliedPromotion {
  /** 活动 ID */
  id: string;
  /** 活动类型 */
  type: 'discount' | 'first_order_discount' | 'reduce' | 'member_level';
  /** 展示标签（如 "7折 优惠"、"首单 8折"、"满500减50"、"9折会员价"） */
  tag: string;
  /** 折扣率（0-100 整数），仅 discount / first_order_discount / member_level 有值 */
  discountRate?: number;
  /** 该活动节省金额（元） */
  savingAmount: number;
  /** 是否被更优折扣覆盖（前端划线展示） */
  overridden?: boolean;
}
