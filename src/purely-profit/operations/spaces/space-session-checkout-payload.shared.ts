import { BadRequestException } from '@nestjs/common';
import type {
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
} from './dto/space-session.dto';
import type {
  CheckoutPreviewFeeMode,
  NormalizedCheckoutPayload,
} from './space-sessions.types';

const MONEY_PRECISION_PATTERN = /^\d+(\.\d{1,2})?$/;

export const normalizeCheckoutPreviewPayload = (
  dto: CheckoutSpaceSessionPreviewDto,
): CheckoutPreviewFeeMode => {
  const timeFeeMode = dto.timeFeeMode;
  const countdownFeeMode =
    dto.countdownFeeMode ??
    (timeFeeMode === 'unit_price'
      ? 'fixed'
      : timeFeeMode === 'timed'
        ? 'timed'
        : undefined);

  return {
    ...(timeFeeMode !== undefined ? { timeFeeMode } : {}),
    ...(countdownFeeMode !== undefined ? { countdownFeeMode } : {}),
  };
};

export const normalizeCheckoutPayload = (
  dto: CheckoutSpaceSessionDto,
): NormalizedCheckoutPayload => {
  const note = dto.note?.trim();
  const grouponCode = dto.grouponCode?.trim();
  const grouponPlatform = dto.grouponPlatform?.trim();
  const voucherCode = dto.voucherCode?.trim();
  const voucherPlatform = dto.voucherPlatform?.trim();
  // 防御性检查：即使 DTO 层必填校验被绕过（如内部调用），也不会抛 TypeError
  if (!dto.lockId) {
    throw new BadRequestException('结账锁单不能为空');
  }
  const lockId = dto.lockId.trim();
  const timeFeeMode = dto.timeFeeMode;
  const countdownFeeMode =
    dto.countdownFeeMode ??
    (timeFeeMode === 'unit_price'
      ? 'fixed'
      : timeFeeMode === 'timed'
        ? 'timed'
        : undefined);

  assertRequiredNonEmpty(lockId, '结账锁单');
  assertNonNegativeInteger(dto.lockedAt, '锁单时间');
  assertMoneyPrecision(dto.platformReceivable, '平台应收金额');
  assertMoneyPrecision(dto.platformSettledAmount, '平台已结金额');
  assertMoneyPrecision(dto.platformFee, '平台手续费');
  assertMoneyPrecision(dto.voucherFaceAmount, '券面金额');

  const effectiveVoucherCode = voucherCode || grouponCode;
  const effectiveVoucherPlatform = voucherPlatform || grouponPlatform;

  if (dto.customerPaymentMethod === 'groupon_voucher') {
    assertRequiredNonEmpty(effectiveVoucherCode, '券码');
    assertRequiredNonEmpty(effectiveVoucherPlatform, '券所属平台');
    assertRequiredNonEmpty(dto.settlementChannel, '结算渠道');
    if (dto.voucherFaceAmount === undefined || dto.voucherFaceAmount <= 0) {
      throw new BadRequestException('券面金额必须大于 0');
    }
  }

  if (
    dto.platformReceivable !== undefined &&
    dto.platformSettledAmount !== undefined &&
    dto.platformSettledAmount > dto.platformReceivable
  ) {
    throw new BadRequestException('平台已结金额不能大于平台应收金额');
  }
  if (
    dto.customerPaymentMethod === 'groupon_voucher' &&
    dto.voucherFaceAmount !== undefined &&
    dto.platformFee !== undefined &&
    dto.platformReceivable !== undefined &&
    dto.platformReceivable > dto.voucherFaceAmount - dto.platformFee
  ) {
    throw new BadRequestException('平台应收金额不能大于券面金额减手续费');
  }

  return {
    paymentMethod: dto.paymentMethod,
    ...(note ? { note } : {}),
    ...(grouponCode ? { grouponCode } : {}),
    ...(grouponPlatform ? { grouponPlatform } : {}),
    ...(dto.customerPaymentMethod !== undefined
      ? { customerPaymentMethod: dto.customerPaymentMethod }
      : {}),
    ...(dto.settlementChannel !== undefined
      ? { settlementChannel: dto.settlementChannel }
      : {}),
    ...(effectiveVoucherCode ? { voucherCode: effectiveVoucherCode } : {}),
    ...(effectiveVoucherPlatform
      ? { voucherPlatform: effectiveVoucherPlatform }
      : {}),
    ...(dto.voucherFaceAmount !== undefined
      ? { voucherFaceAmount: dto.voucherFaceAmount }
      : {}),
    ...(dto.settlementStatus !== undefined
      ? { settlementStatus: dto.settlementStatus }
      : {}),
    ...(dto.platformReceivable !== undefined
      ? { platformReceivable: dto.platformReceivable }
      : {}),
    ...(dto.platformSettledAmount !== undefined
      ? { platformSettledAmount: dto.platformSettledAmount }
      : {}),
    ...(dto.platformFee !== undefined ? { platformFee: dto.platformFee } : {}),
    ...(timeFeeMode !== undefined ? { timeFeeMode } : {}),
    ...(countdownFeeMode !== undefined ? { countdownFeeMode } : {}),
    lockId,
    lockedAt: dto.lockedAt,
  };
};

const assertRequiredNonEmpty = (
  value: string | undefined,
  label: string,
): void => {
  if (!value) {
    throw new BadRequestException(`${label}不能为空`);
  }
};

const assertNonNegativeInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${label}必须是不小于 0 的整数`);
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
