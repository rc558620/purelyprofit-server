import { BadRequestException } from '@nestjs/common';
import type { NormalizedOpenSessionPayload } from './space-sessions.types';

const SPACE_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;
const MONEY_PRECISION_PATTERN = /^\d+(\.\d{1,2})?$/;

export const ensureOpenSessionPayload = (
  payload: NormalizedOpenSessionPayload,
  capacity?: number,
): void => {
  if (payload.guestPhone && !SPACE_CONTACT_PATTERN.test(payload.guestPhone)) {
    throw new BadRequestException(
      '顾客电话格式不正确，请输入 6-20 位数字或常见联系电话格式',
    );
  }
  if (payload.guestCount !== undefined) {
    assertPositiveInteger(payload.guestCount, '顾客人数');
    if (capacity !== undefined && payload.guestCount > capacity) {
      throw new BadRequestException('顾客人数不能超过空间容量');
    }
  }

  if (payload.billingMode === 'timed' || payload.billingMode === 'mixed') {
    if (payload.hourlyRate === undefined || payload.hourlyRate <= 0) {
      throw new BadRequestException('请输入有效的计时单价');
    }
    assertMoneyPrecision(payload.hourlyRate, '计时单价');
  }

  if (payload.billingMode === 'countdown') {
    if (
      payload.countdownMinutes === undefined ||
      payload.countdownMinutes <= 0
    ) {
      throw new BadRequestException('请输入有效的倒计时时长');
    }
    assertPositiveInteger(payload.countdownMinutes, '倒计时时长');
    if (payload.hourlyRate === undefined || payload.hourlyRate <= 0) {
      throw new BadRequestException('请输入台位费');
    }
    assertMoneyPrecision(payload.hourlyRate, '台位费');
    if (payload.autoCheckout) {
      const prepaidVoucherCode =
        payload.prepaidVoucherCode ?? payload.prepaidGrouponCode;
      const prepaidVoucherPlatform =
        payload.prepaidVoucherPlatform ?? payload.prepaidGrouponPlatform;
      const prepaidVoucherFaceAmount =
        payload.prepaidVoucherFaceAmount ?? payload.prepaidAmount;
      const prepaidCustomerPaymentMethod =
        payload.prepaidCustomerPaymentMethod ??
        (prepaidVoucherCode || prepaidVoucherPlatform
          ? 'groupon_voucher'
          : payload.prepaidPaymentMethod);
      const prepaidSettlementChannel =
        payload.prepaidSettlementChannel ??
        (prepaidCustomerPaymentMethod === 'groupon_voucher'
          ? (() => {
              const normalized = prepaidVoucherPlatform?.trim().toLowerCase();
              if (!normalized) {
                return 'other_platform' as const;
              }
              if (normalized.includes('美团')) {
                return 'meituan_groupon' as const;
              }
              if (normalized.includes('抖音')) {
                return 'douyin_groupon' as const;
              }
              return 'other_platform' as const;
            })()
          : 'direct_cashier');

      if (
        payload.prepaidPaymentMethod === undefined ||
        payload.prepaidAmount === undefined ||
        payload.prepaidAmount <= 0
      ) {
        throw new BadRequestException('自动结账模式下请输入付款金额与支付方式');
      }
      assertMoneyPrecision(payload.prepaidAmount, '预付金额');

      if (prepaidCustomerPaymentMethod === 'groupon_voucher') {
        assertRequiredNonEmpty(prepaidVoucherCode, '预付券码');
        assertRequiredNonEmpty(prepaidVoucherPlatform, '预付券所属平台');
        assertRequiredNonEmpty(prepaidSettlementChannel, '预付结算渠道');
        if (
          prepaidVoucherFaceAmount === undefined ||
          prepaidVoucherFaceAmount <= 0
        ) {
          throw new BadRequestException('预付券面金额必须大于 0');
        }
        assertMoneyPrecision(prepaidVoucherFaceAmount, '预付券面金额');
      }
    }
    return;
  }

  if (payload.autoCheckout) {
    throw new BadRequestException('仅倒计时会话支持自动结账');
  }
};

const assertRequiredNonEmpty = (
  value: string | undefined,
  label: string,
): void => {
  if (!value) {
    throw new BadRequestException(`${label}不能为空`);
  }
};

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${label}必须是大于 0 的整数`);
  }
};

const assertMoneyPrecision = (
  value: number | undefined,
  label: string,
): void => {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || !MONEY_PRECISION_PATTERN.test(String(value))) {
    throw new BadRequestException(`${label}最多支持两位小数`);
  }
};
