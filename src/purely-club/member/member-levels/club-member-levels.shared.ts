import Decimal from 'decimal.js';
import type {
  ClubMemberHeldLevelValue,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';

export type ClubMemberLevelSettingRecord = {
  levels: unknown;
};

export interface ClubMemberLevelResolution {
  heldLevel: ClubMemberHeldLevelValue;
  heldLevelLabel: string;
  heldLevelVisible: boolean;
  currentLevelConfig: import('../dto/club-member-account.dto').ClubMemberLevelConfigDto;
  visibleLevelConfigs: import('../dto/club-member-account.dto').ClubMemberLevelConfigDto[];
}

export const CLUB_MEMBER_HELD_LEVEL_LABEL_MAP: Record<
  ClubMemberHeldLevelValue,
  string
> = {
  regular: '普通会员',
  gold: '黄金会员',
  platinum: '铂金会员',
  diamond: '钻石会员',
};

export const CLUB_MEMBER_LEVEL_META: Record<
  ClubMemberLevelValue,
  {
    color: string;
    bgColor: string;
    extraBenefits: string[];
  }
> = {
  regular: {
    color: '#8c8c8c',
    bgColor: '#f5f5f5',
    extraBenefits: ['充值即可升级享会员折扣'],
  },
  gold: {
    color: '#b7862f',
    bgColor: '#fbf3df',
    extraBenefits: ['优先预约通道', '会员成长专属提醒'],
  },
  platinum: {
    color: '#9f67d4',
    bgColor: '#f3efff',
    extraBenefits: ['热门时段优先预约', '专属会员活动通知'],
  },
  diamond: {
    color: '#6fa8ff',
    bgColor: '#ecf4ff',
    extraBenefits: ['高峰时段优先保障', '专属会员福利提醒'],
  },
};

/* ──────────────── 纯计算 / 格式化工具函数 ──────────────── */

export function normalizeRate(rate: number): number {
  return new Decimal(rate).toDecimalPlaces(2).toNumber();
}

export function formatDiscountLabel(discountRate: number): string {
  const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
  const normalized = discount.isInteger()
    ? discount.toFixed(0)
    : discount.toFixed(1);
  return `${normalized}折会员专属价`;
}

export function formatDiscountShortText(discountRate: number): string {
  const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
  const normalized = discount.isInteger()
    ? discount.toFixed(0)
    : discount.toFixed(1);
  return `${normalized}折`;
}

export function formatAmount(amount: number): string {
  const decimal = new Decimal(amount).toDecimalPlaces(2);
  return decimal.isInteger() ? decimal.toFixed(0) : decimal.toFixed(2);
}

export function calculateAmountToNextLevel(
  totalConsume: number,
  nextRequiredConsume: number,
): number {
  return Decimal.max(0, new Decimal(nextRequiredConsume).minus(totalConsume))
    .toDecimalPlaces(2)
    .toNumber();
}

export function calculateProgressPct(
  totalConsume: number,
  currentRequiredConsume: number,
  nextRequiredConsume: number,
): number {
  const span = new Decimal(nextRequiredConsume).minus(currentRequiredConsume);
  if (span.lte(0)) {
    return totalConsume >= nextRequiredConsume ? 100 : 0;
  }

  return Decimal.min(
    100,
    Decimal.max(
      0,
      new Decimal(totalConsume)
        .minus(currentRequiredConsume)
        .div(span)
        .mul(100)
        .toDecimalPlaces(2),
    ),
  ).toNumber();
}
