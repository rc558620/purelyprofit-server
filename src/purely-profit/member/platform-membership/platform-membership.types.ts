import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerLevelDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipPromoRecordDto,
  PlatformMembershipPromoStatsDto,
} from './dto/platform-membership-response.dto';

export type PromoDetailCompatQueryMode = 'all' | 'day' | 'month' | 'year';

export interface PromotionDetailCompatResponse {
  inviteCode: string;
  promoCode: string;
  memberInfo: PlatformMembershipProfileResponseDto['memberInfo'];
  approvedPartner: PlatformMembershipProfileResponseDto['approvedPartner'];
  level: PlatformMembershipPartnerLevelDto;
  stats: PlatformMembershipPromoStatsDto;
  statsByPeriod: PlatformMembershipPromoCenterResponseDto['statsByPeriod'];
  items: PlatformMembershipPromoRecordDto[];
  list: PlatformMembershipPromoRecordDto[];
  records: PlatformMembershipPromoRecordDto[];
  total: number;
  queryMode: PromoDetailCompatQueryMode;
  date: string | null;
}

export interface PromoDetailCompatFilters {
  queryMode: PromoDetailCompatQueryMode;
  date: string | null;
  keyword: string | null;
}

export interface PromoDetailCompatRange {
  start: number;
  end: number;
}

export interface PromoDetailDateParts {
  year: number;
  month?: number;
  day?: number;
}

export interface MembershipPlanConfig {
  id: PlatformMembershipPlanId;
  name: string;
  price: number;
  originalPrice: number | null;
  durationMonths: number | null;
  validDays: number | null;
  badge?: string;
  recommended?: boolean;
  monthlyPrice?: number;
}

export interface MembershipPlanRuleConfig {
  key: string;
  name: string;
  free: string;
  monthly: string;
  quarterly: string;
  yearly: string;
}

export type MembershipPlanSettingIdValue =
  | PlatformMembershipPlanId
  | 'lifetime';

export interface MembershipPlanSettingRecord {
  planId: MembershipPlanSettingIdValue;
  planName: string;
  price: number;
  originalPrice: number | null;
  durationMonths: number | null;
  validDays: number | null;
  updatedAt: Date;
}

export interface StoreMembershipProfileRecord {
  id: number;
  storeId: number;
  currentPlanId: PlatformMembershipPlanId | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  totalPoints: number;
  availablePoints: number;
}

export interface StoreMembershipOrderRecord {
  id: number;
  planId: PlatformMembershipPlanId;
  planName: string;
  amount: number;
  pointsDeducted: number;
  pointsUsed: number;
  beanDeducted: number;
  beansUsed: number;
  status: MembershipOrderStatusValue;
  paymentChannel: 'wechat';
  paymentOrderId: string | null;
  createdAt: Date;
}

export interface StoreMembershipPointsLogRecord {
  id: number;
  source: PointsSourceValue;
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
}

export interface StoreMembershipPromoRecord {
  id: number;
  inviteeName: string;
  inviteePhone: string;
  registeredAt: Date;
  hasCharged: boolean;
  chargedAmount: number | null;
  chargedAt: Date | null;
  chargedPlan: PlatformMembershipPlanId | null;
  rewardBeans: number | null;
  settled: boolean;
}

export interface StorePartnerRecord {
  id: number;
  status: PartnerStatusValue;
  name: string | null;
  phone: string | null;
  idCard: string | null;
  region: string[];
  intention: PartnerIntentionValue | null;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue | null;
  paymentAccountNo: string | null;
  paymentAccountName: string | null;
  beanBalance: number;
  totalEarnedBeans: number;
  totalWithdrawnBeans: number;
  joinedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface StorePartnerApplicationNoteRecord {
  id: number;
  content: string;
  createdAt: Date;
}

export interface StorePartnerApplicationRecord {
  id: number;
  storeId: number;
  status: PartnerStatusValue;
  name: string;
  phone: string;
  idCard: string;
  region: string[];
  intention: PartnerIntentionValue;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue;
  paymentAccountNo: string;
  paymentAccountName: string;
  reviewedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  followUpNotes: StorePartnerApplicationNoteRecord[];
}

export interface StorePartnerBeanLogRecord {
  id: number;
  source: BeanSourceValue;
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  relatedPlanType: PlatformMembershipPlanId | null;
  createdAt: Date;
}

export interface PaymentCalculationResult {
  beanDeductAmount: number;
  actualBeansUsed: number;
  priceAfterBeans: number;
  pointsDeductAmount: number;
  actualPointsUsed: number;
  finalAmount: number;
}

export interface PartnerSnapshotPayload {
  name: string;
  phone: string;
  idCard: string;
  region: string[];
  intention: PartnerIntentionValue;
  applyReason: string | null;
  paymentAccountType: PartnerPaymentMethodValue;
  paymentAccountNo: string;
  paymentAccountName: string;
}

export type PrismaExecutor = PrismaService | Prisma.TransactionClient;
export type MembershipOrderStatusValue =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded';
export type PartnerStatusValue =
  | 'pending'
  | 'reviewing'
  | 'approved'
  | 'rejected';
export type PartnerIntentionValue = 'agent' | 'invest' | 'resource' | 'other';
export type PartnerPaymentMethodValue = 'wechat' | 'alipay' | 'bank';
export type PointsSourceValue =
  | 'purchase_bonus'
  | 'deduct_payment'
  | 'admin_adjust'
  | 'expire';
export type PointsTypeValue = 'earn' | 'spend' | 'expire';
export type BeanSourceValue =
  | 'promo_reward'
  | 'deduct_payment'
  | 'withdrawal'
  | 'admin_adjust';
export type BeanTypeValue = 'earn' | 'spend' | 'withdraw';
export type PartnerLevelValue = 'star' | 'elite' | 'legend';
