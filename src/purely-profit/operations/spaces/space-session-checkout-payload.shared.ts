import { BadRequestException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type {
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
} from './dto/space-session.dto';
import type {
  CheckoutPreviewFeeMode,
  NormalizedCheckoutPayload,
} from './space-sessions.types';
import type { SpaceSettlementChannelValue } from './dto/space-session.constants';

export const MONEY_PRECISION_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * G3 fix: 从团购平台枚举值自动推导结算渠道。
 * 支持美团/抖音及其他平台的中文与英文名称匹配，
 * 未知平台统一返回 other_platform。
 */
export const resolveSettlementChannelFromPlatform = (
  platform: string | undefined,
): SpaceSettlementChannelValue => {
  if (!platform) return 'other_platform';
  const normalized = platform.trim().toLowerCase();
  if (
    normalized === 'meituan' ||
    normalized.includes('美团') ||
    normalized.includes('meituan')
  ) {
    return 'meituan_groupon';
  }
  if (
    normalized === 'douyin' ||
    normalized.includes('抖音') ||
    normalized.includes('douyin') ||
    normalized.includes('tiktok')
  ) {
    return 'douyin_groupon';
  }
  // G3: 其余已知平台虽仍映射到 other_platform，但通过中文标签显式识别
  // 以便日志/调试时明确来源，未来若扩展枚举可直接补充 return 分支
  return 'other_platform';
};

/**
 * R2 fix: 导出供 renew.service 复用的平台推导函数（与 checkout 共享同一逻辑）。
 */
export const resolveSettlementChannelFromPlatformForRenew =
  resolveSettlementChannelFromPlatform;

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

  // 团购券场景：paymentMethod 或 customerPaymentMethod 任一为 groupon_voucher 即触发校验
  const isGrouponPayment =
    dto.paymentMethod === 'groupon_voucher' ||
    dto.customerPaymentMethod === 'groupon_voucher';

  // 结算渠道：优先用显式传入的值，否则从团购平台名称自动推导
  const resolvedSettlementChannel = (dto.settlementChannel?.trim() ||
    (isGrouponPayment
      ? resolveSettlementChannelFromPlatform(effectiveVoucherPlatform)
      : undefined)) as SpaceSettlementChannelValue | undefined;

  if (isGrouponPayment) {
    assertRequiredNonEmpty(effectiveVoucherCode, '券码');
    assertRequiredNonEmpty(effectiveVoucherPlatform, '券所属平台');
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
    isGrouponPayment &&
    dto.voucherFaceAmount !== undefined &&
    dto.platformFee !== undefined &&
    dto.platformReceivable !== undefined &&
    dto.platformReceivable > dto.voucherFaceAmount - dto.platformFee
  ) {
    throw new BadRequestException('平台应收金额不能大于券面金额减手续费');
  }

  // B5 fix: 后端权威计算 platformReceivable = voucherFaceAmount - platformFee
  // 不信任前端传入值，防止对账偏差
  const authoritativePlatformReceivable =
    dto.voucherFaceAmount !== undefined && dto.platformFee !== undefined
      ? Money.fromInputYuan(dto.voucherFaceAmount)
          .subtract(Money.fromInputYuan(dto.platformFee))
          .toOutputYuan()
      : dto.platformReceivable;

  return {
    paymentMethod: dto.paymentMethod,
    ...(note ? { note } : {}),
    ...(grouponCode ? { grouponCode } : {}),
    ...(grouponPlatform ? { grouponPlatform } : {}),
    ...(dto.customerPaymentMethod !== undefined
      ? { customerPaymentMethod: dto.customerPaymentMethod }
      : {}),
    ...(resolvedSettlementChannel !== undefined
      ? { settlementChannel: resolvedSettlementChannel }
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
    ...(authoritativePlatformReceivable !== undefined
      ? { platformReceivable: authoritativePlatformReceivable }
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

export const assertMoneyPrecision = (
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
