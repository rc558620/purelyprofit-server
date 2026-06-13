export const CLUB_HOT_PRODUCT_COUNT = 3;
export const CLUB_FEATURED_PRODUCT_LIMIT = 6;
export const CLUB_PRODUCT_NOT_FOUND_MESSAGE = '当前门店下找不到该服务商品';

export const clubProductSelect = {
  id: true,
  categoryId: true,
  name: true,
  price: true,
  originalPrice: true,
  image: true,
  description: true,
  stock: true,
  durationMinutes: true,
  personCount: true,
  createdAt: true,
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
  description: string | null;
  stock?: number | null;
  durationMinutes: number | null;
  personCount: number | null;
  createdAt: Date;
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
