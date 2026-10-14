// ─── 营销产品计费 / 价格规则（纯函数，无副作用）──────────────────────
//
// 与前端对齐的两条不变量此前只存在于此处，抽离后 create / update 共用同一份：
// 1. 非团购券商品一律清空计费字段（前端切类型后隐藏字段仍会提交）；
// 2. 倒计时模式要求预设时长与服务时长非空且一致。
// 金额换算统一走 Money 体系：入参单位为「元」，输出统一为「分」。

import { BadRequestException } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import type {
  CalculateTimingPriceDto,
  CalculateTimingPriceResponseDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type { MarketingProductRow } from './marketing.types';
import {
  MARKETING_PRODUCT_BILLING_MODE_VALUES,
  MARKETING_PRODUCT_TYPE_VALUES,
  safeEnumCoerce,
  type MarketingProductBillingModeValue,
  type MarketingProductTypeValue,
} from './marketing.utils';

/** 归一化后的团购券/开台计费配置（金额统一为「分」） */
export interface NormalizedProductBilling {
  validDays: number | null;
  billingMode: MarketingProductBillingModeValue;
  hourlyRateCents: number | null;
  countdownMinutes: number | null;
  countdownPriceCents: number | null;
  autoCheckout: boolean;
}

/** 归一化入参：type 为生效的商品类型（更新场景需传入合并后的值） */
export interface NormalizedProductBillingInput {
  type: MarketingProductTypeValue;
  billingMode: MarketingProductBillingModeValue;
  durationMinutes: number | null;
  validDays: number | null;
  /** 单位「元」 */
  hourlyRate: number | null;
  countdownMinutes: number | null;
  /** 单位「元」 */
  countdownPrice: number | null;
  autoCheckout: boolean;
}

const EMPTY_BILLING: NormalizedProductBilling = {
  validDays: null,
  billingMode: 'items',
  hourlyRateCents: null,
  countdownMinutes: null,
  countdownPriceCents: null,
  autoCheckout: false,
};

function isTimedMode(
  mode: MarketingProductBillingModeValue,
): mode is 'timed' | 'mixed' {
  return mode === 'timed' || mode === 'mixed';
}

/**
 * 归一化团购券 / 开台计费配置。
 *
 * 1. 非团购券商品一律清空 validDays 与开台计费字段：前端切换商品类型后
 *    隐藏字段值仍会保留并提交（useForm 有意保留 unmount 字段值），
 *    若不清洗会在 service 商品上留下脏的计费配置。
 * 2. 倒计时模式要求预设时长与服务时长非空且一致：开台计时以
 *    countdownMinutes 为准，与服务时长不符会导致计费账实不符。
 */
export function normalizeBillingConfig(
  input: NormalizedProductBillingInput,
): NormalizedProductBilling {
  if (input.type !== 'voucher') {
    return EMPTY_BILLING;
  }

  const toCents = (yuan: number | null): number | null =>
    yuan != null ? Money.fromInputYuan(yuan).toDbCents() : null;

  const normalized: NormalizedProductBilling = {
    validDays: input.validDays,
    billingMode: input.billingMode,
    hourlyRateCents: toCents(input.hourlyRate),
    countdownMinutes: input.countdownMinutes,
    countdownPriceCents: toCents(input.countdownPrice),
    autoCheckout: input.autoCheckout,
  };

  // 按计费方式保留对应字段、清空其它计费方式的专属字段，
  // 避免前端切换计费方式后隐藏字段的残留值写库
  if (normalized.billingMode === 'countdown') {
    if (normalized.countdownMinutes == null) {
      throw new BadRequestException('请填写预设时长');
    }
    if (input.durationMinutes == null) {
      throw new BadRequestException('请填写服务时长');
    }
    if (normalized.countdownMinutes !== input.durationMinutes) {
      throw new BadRequestException('预设时长与服务时长不一致，请保持一致');
    }
    return { ...normalized, hourlyRateCents: null };
  }

  if (isTimedMode(normalized.billingMode)) {
    return {
      ...normalized,
      countdownMinutes: null,
      countdownPriceCents: null,
      autoCheckout: false,
    };
  }

  // items（纯消费）：无需任何开台计费参数，但保留团购券有效天数
  return {
    ...normalized,
    hourlyRateCents: null,
    countdownMinutes: null,
    countdownPriceCents: null,
    autoCheckout: false,
  };
}

/** B-3 fix：划线价不得低于售价 */
export function assertOriginalPriceNotLessThanPrice(
  priceYuan: number,
  originalPriceYuan: number | null | undefined,
): void {
  if (originalPriceYuan == null) return;
  const priceCents = Money.fromInputYuan(priceYuan).toDbCents();
  const originalCents = Money.fromInputYuan(originalPriceYuan).toDbCents();
  if (originalCents < priceCents) {
    throw new BadRequestException('划线价不能低于售价');
  }
}

/** 新增场景：DTO → 归一化计费配置（含划线价校验） */
export function resolveCreatedProductBilling(
  dto: CreateMarketingProductDto,
): NormalizedProductBilling {
  assertOriginalPriceNotLessThanPrice(dto.price, dto.originalPrice);

  return normalizeBillingConfig({
    type: dto.type ?? 'service',
    billingMode: dto.billingMode ?? 'items',
    durationMinutes: dto.durationMinutes ?? null,
    validDays: dto.validDays ?? null,
    hourlyRate: dto.hourlyRate ?? null,
    countdownMinutes: dto.countdownMinutes ?? null,
    countdownPrice: dto.countdownPrice ?? null,
    autoCheckout: dto.autoCheckout ?? false,
  });
}

/**
 * 编辑场景：先合并库存产品现状与本次 PATCH 入参，再做价格校验与计费归一化，
 * 保证「非团购券商品」与「倒计时」两条不变量在 PATCH 语义下同样成立。
 */
export function resolveUpdatedProductBilling(
  product: MarketingProductRow,
  dto: UpdateMarketingProductDto,
): NormalizedProductBilling {
  // B-3 fix：合并已有值与本次更新值，校验划线价不得低于售价
  const effectivePriceYuan =
    dto.price != null
      ? dto.price
      : Money.fromDbCents(product.price).toOutputYuan();
  const effectiveOriginalYuan =
    dto.originalPrice !== undefined
      ? dto.originalPrice
      : product.originalPrice != null
        ? Money.fromDbCents(product.originalPrice).toOutputYuan()
        : null;
  assertOriginalPriceNotLessThanPrice(
    effectivePriceYuan,
    effectiveOriginalYuan,
  );

  const currentType = safeEnumCoerce(
    product.type,
    MARKETING_PRODUCT_TYPE_VALUES,
    'service',
  );
  const currentBillingMode = safeEnumCoerce(
    product.billingMode,
    MARKETING_PRODUCT_BILLING_MODE_VALUES,
    'items',
  );
  const toYuan = (cents: number | null): number | null =>
    cents != null ? Money.fromDbCents(cents).toOutputYuan() : null;

  return normalizeBillingConfig({
    type: dto.type ?? currentType,
    billingMode: dto.billingMode ?? currentBillingMode,
    durationMinutes:
      dto.durationMinutes !== undefined
        ? (dto.durationMinutes ?? null)
        : product.durationMinutes,
    validDays:
      dto.validDays !== undefined ? (dto.validDays ?? null) : product.validDays,
    hourlyRate:
      dto.hourlyRate !== undefined
        ? (dto.hourlyRate ?? null)
        : toYuan(product.hourlyRate),
    countdownMinutes:
      dto.countdownMinutes !== undefined
        ? (dto.countdownMinutes ?? null)
        : product.countdownMinutes,
    countdownPrice:
      dto.countdownPrice !== undefined
        ? (dto.countdownPrice ?? null)
        : toYuan(product.countdownPrice),
    autoCheckout: dto.autoCheckout ?? product.autoCheckout,
  });
}

/**
 * 自动计算费率（金额计算权在后端，前端仅传参并展示结果）：
 * - per_session（倒计时台位费）：整次价格 = 售价（元/次），时长仅作必填校验
 * - per_hour（计时单价，默认）：售价（分）÷ 时长（分钟）× 60，四舍五入到分（元/小时）
 */
export function calculateTimingPrice(
  dto: CalculateTimingPriceDto,
): CalculateTimingPriceResponseDto {
  if (dto.mode === 'per_session') {
    return {
      rate: Money.fromInputYuan(dto.price).toOutputYuan(),
    };
  }
  const priceCents = Money.fromInputYuan(dto.price).toDbCents();
  const rateCents = Math.round((priceCents * 60) / dto.durationMinutes);
  return {
    rate: Money.fromDbCents(rateCents).toOutputYuan(),
  };
}
