import type {
  MarketingCustomerStatus,
  MarketingCustomerTierValue,
  MarketingPointsChangeTypeValue,
  MarketingProductSortValue,
  MarketingPromotionStatus,
} from './marketing.utils';

export interface MarketingCustomerRow {
  id: number;
  storeId: number;
  /** 关联的 Member.id（可为 null，兼容历史数据） */
  memberId: number | null;
  name: string;
  phone: string | null;
  avatar: string | null;
  tier: MarketingCustomerTierValue;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: Date | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingRechargeRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  giftAmount: number;
  /** 到账总额（分）= amount + giftAmount */
  totalAmount: number;
  type: string;
  promotionId: number | null;
  promotionName: string | null;
  note: string | null;
  createdAt: Date;
}

export interface MarketingConsumptionRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  balancePaid: number;
  /** 积分抵扣金额（分） */
  pointsDeducted: number;
  /** 实际扣减积分个数（写入时由 ratio 折算固化） */
  actualPointsDeducted: number;
  payType: string;
  itemsSummary: string | null;
  promotionId: number | null;
  promotionName: string | null;
  createdAt: Date;
}

export interface MarketingPointsRecordRow {
  id: number;
  storeId: number;
  customerId: number;
  amount: number;
  type: MarketingPointsChangeTypeValue;
  description: string;
  createdAt: Date;
}

export interface MarketingCountRow {
  count: number;
}

export interface MarketingPromotionRow {
  id: number;
  storeId: number;
  name: string;
  type: string;
  description: string;
  params: unknown;
  startAt: Date;
  endAt: Date;
  usageCount: number;
  totalDiscount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingProductCategoryRow {
  id: number;
  storeId: number;
  name: string;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingProductRow {
  id: number;
  storeId: number;
  categoryId: number;
  categoryName: string;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  descriptionTitle: string | null;
  description: string | null;
  stock: number;
  durationMinutes: number | null;
  personCount: number | null;
  unit: string | null;
  /** 商品类型：service=服务商品 voucher=团购券商品 */
  type: 'service' | 'voucher';
  /** 团购券有效天数（type=voucher 时生效） */
  validDays: number | null;
  /** 开台计费方式（type=voucher 时生效）：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时 */
  billingMode: string;
  /** 计时单价（分，billingMode=timed/mixed 时生效） */
  hourlyRate: number | null;
  /** 预设时长（分钟，billingMode=countdown 时生效） */
  countdownMinutes: number | null;
  /** 台位费（分，billingMode=countdown 时生效） */
  countdownPrice: number | null;
  /** 到时自动结账（billingMode=countdown 时生效） */
  autoCheckout: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingOverviewTrendPoint {
  date: string;
  amount: number;
}

export interface MarketingOverviewMonthlyTrendPoint {
  label: string;
  amount: number | null;
}

export interface MarketingCustomerListQueryInput {
  storeId: number;
  status?: MarketingCustomerStatus;
  tier?: MarketingCustomerTierValue;
  /** 兼容旧版：同时匹配姓名和手机号 */
  keyword?: string;
  /** 独立姓名搜索框关键字 */
  name?: string;
  /** 独立手机号搜索框关键字 */
  phone?: string;
  page?: number;
  pageSize?: number;
}

export interface MarketingRechargeListQueryInput {
  storeId: number;
  customerId?: number;
  startMs?: number;
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface MarketingCustomerScopedPageQuery {
  page?: number;
  pageSize?: number;
}

export interface MarketingPointsRecordListQueryInput {
  storeId: number;
  customerId?: number;
  type?: MarketingPointsChangeTypeValue;
  startMs?: number;
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface MarketingPromotionListQueryInput {
  storeId: number;
  status?: MarketingPromotionStatus;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MarketingProductListQueryInput {
  storeId: number;
  categoryId?: number;
  sortBy?: MarketingProductSortValue;
}
