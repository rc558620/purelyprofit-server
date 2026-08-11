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

    // 派生字段已由 normalizeOpenSessionPayload 写入 payload，此处直接读取
    const hasPrepaid =
      payload.prepaidPaymentMethod !== undefined ||
      payload.prepaidAmount !== undefined ||
      payload.prepaidVoucherFaceAmount !== undefined ||
      payload.prepaidVoucherCode !== undefined ||
      payload.prepaidVoucherPlatform !== undefined ||
      payload.prepaidNote !== undefined ||
      payload.prepaidGrouponCode !== undefined ||
      payload.prepaidGrouponPlatform !== undefined;

    if (hasPrepaid) {
      // BUG-5 fix: 团购预付允许以 prepaidCustomerPaymentMethod + voucherFaceAmount 作为有效预付组合，
      // 不强制要求传统 prepaidPaymentMethod / prepaidAmount
      const isGrouponPrepaid =
        payload.prepaidCustomerPaymentMethod === 'groupon_voucher';

      if (isGrouponPrepaid) {
        // 团购预付：必须有券码、平台、结算渠道、券面金额
        assertRequiredNonEmpty(payload.prepaidVoucherCode, '预付券码');
        assertRequiredNonEmpty(
          payload.prepaidVoucherPlatform,
          '预付券所属平台',
        );
        assertRequiredNonEmpty(
          payload.prepaidSettlementChannel,
          '预付结算渠道',
        );
        if (
          payload.prepaidVoucherFaceAmount === undefined ||
          payload.prepaidVoucherFaceAmount <= 0
        ) {
          throw new BadRequestException('预付券面金额必须大于 0');
        }
        assertMoneyPrecision(payload.prepaidVoucherFaceAmount, '预付券面金额');
        // B4 fix: 团购场景下实付金额不应超过券面金额，
        // 与续费链路 normalizeRenewPayload 的 G4 校验保持一致
        if (
          payload.prepaidAmount !== undefined &&
          payload.prepaidVoucherFaceAmount !== undefined &&
          payload.prepaidAmount > payload.prepaidVoucherFaceAmount
        ) {
          throw new BadRequestException(
            '预付金额不能超过券面金额（团购券规则：实付 ≤ 券面）',
          );
        }
        // 堵入口 fix: 团购券面金额不能低于台位费。
        // 商家从团购平台结算收到的钱 = 券面金额，券面 < 台位费会导致利润与实收不符；
        // 前端开台会自动将台位费同步为券面金额，后端镜像同规则拒绝绕过前端的请求。
        if (
          payload.hourlyRate !== undefined &&
          payload.prepaidVoucherFaceAmount < payload.hourlyRate
        ) {
          throw new BadRequestException('团购券面金额不能低于台位费');
        }
      } else {
        // 传统预付：必须有支付方式和预付金额
        if (
          payload.prepaidPaymentMethod === undefined ||
          payload.prepaidAmount === undefined ||
          payload.prepaidAmount <= 0
        ) {
          throw new BadRequestException('开启预付款后请输入付款金额与支付方式');
        }
        assertMoneyPrecision(payload.prepaidAmount, '预付金额');
      }
    }

    // BUG-4 / 规则7 fix: 无预付也可开启自动结账。
    // 前端开台已保证「自动结账金额 ≥ 台位费」，因此无预付会话在到达自动结账时间后
    // 会被正常结算台位费，不再被自动结账扫描永久跳过（避免空间被永久占用）。
    // 后端此处镜像同一约束：仅当 autoCheckout 既无预付又无有效台位费（hourlyRate ≤ 0）时拒绝；
    // 而 hourlyRate > 0 已在上方校验，故该组合理论不可达。
    if (
      payload.autoCheckout &&
      !hasPrepaid &&
      (payload.hourlyRate === undefined || payload.hourlyRate <= 0)
    ) {
      throw new BadRequestException(
        '开启自动结账必须设置预付款方式或有效的台位费',
      );
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
