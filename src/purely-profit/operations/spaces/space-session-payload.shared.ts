import { BadRequestException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import {
  assertMoneyPrecision,
  resolveSettlementChannelFromPlatform,
} from './space-session-checkout-payload.shared';
import type {
  OpenSpaceSessionDto,
  RenewSpaceSessionDto,
} from './dto/space-session.dto';
import type { CommissionAssignmentDto } from '../commission/dto/commission-assignment.dto';
import type {
  NormalizedOpenSessionPayload,
  NormalizedRenewPayload,
  SpaceSessionItemRecord,
} from './space-sessions.types';
import type { CommissionAssignmentInput } from '../commission/commission.types';

/** 续费金额上限（元）：避免极大值导致 countdownMinutes 溢出或异常时长 */
const RENEW_AMOUNT_MAX = 99999.99;

export const normalizeOpenSessionPayload = (
  dto: OpenSpaceSessionDto,
): NormalizedOpenSessionPayload => {
  const guestName = dto.guestName?.trim();
  const guestPhone = dto.guestPhone?.trim();
  const prepaidGrouponCode = dto.prepaidGrouponCode?.trim();
  const prepaidGrouponPlatform = dto.prepaidGrouponPlatform?.trim();
  const prepaidVoucherCode = dto.prepaidVoucherCode?.trim();
  const prepaidVoucherPlatform = dto.prepaidVoucherPlatform?.trim();
  const prepaidNote = dto.prepaidNote?.trim();

  // 派生字段：从旧字段（prepaidGrouponCode/Platform）或通用字段（prepaidAmount）推导，
  // 确保校验阶段和落库阶段使用相同的值，避免校验通过但字段以 null 落库。
  const derivedVoucherCode = prepaidVoucherCode ?? prepaidGrouponCode;
  const derivedVoucherPlatform =
    prepaidVoucherPlatform ?? prepaidGrouponPlatform;
  const derivedVoucherFaceAmount =
    dto.prepaidVoucherFaceAmount ??
    // BUG-5 fix: 仅在存在真实团购券时才派生券面金额，
    // 防止普通预付的 prepaidAmount 被误计入“券面金额”字段，
    // 导致团购报表把普通预付误统为券面金额。
    (derivedVoucherCode || derivedVoucherPlatform
      ? dto.prepaidAmount
      : undefined);
  const derivedCustomerPaymentMethod =
    dto.prepaidCustomerPaymentMethod ??
    (derivedVoucherCode || derivedVoucherPlatform
      ? ('groupon_voucher' as const)
      : dto.prepaidPaymentMethod);
  // P1 fix: 复用结账侧 resolveSettlementChannelFromPlatform，
  // 统一中英文平台匹配逻辑，避免开台侧仅匹配中文导致英文枚举（meituan/douyin）
  // 被错误归为 other_platform。
  const derivedSettlementChannel =
    dto.prepaidSettlementChannel ??
    (derivedCustomerPaymentMethod === 'groupon_voucher'
      ? resolveSettlementChannelFromPlatform(derivedVoucherPlatform)
      : ('direct_cashier' as const));

  return {
    ...(guestName ? { guestName } : {}),
    ...(guestPhone ? { guestPhone } : {}),
    ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
    billingMode: dto.billingMode,
    ...(dto.hourlyRate !== undefined ? { hourlyRate: dto.hourlyRate } : {}),
    ...(dto.countdownMinutes !== undefined
      ? { countdownMinutes: dto.countdownMinutes }
      : {}),
    ...(dto.autoCheckout !== undefined
      ? { autoCheckout: dto.autoCheckout }
      : {}),
    ...(dto.reservationId !== undefined
      ? { reservationId: dto.reservationId }
      : {}),
    ...(dto.prepaidPaymentMethod !== undefined
      ? { prepaidPaymentMethod: dto.prepaidPaymentMethod }
      : {}),
    // 派生字段在前，显式传入字段在后（显式值优先覆盖派生值）
    ...(derivedCustomerPaymentMethod !== undefined
      ? { prepaidCustomerPaymentMethod: derivedCustomerPaymentMethod }
      : {}),
    ...(derivedSettlementChannel !== undefined
      ? { prepaidSettlementChannel: derivedSettlementChannel }
      : {}),
    ...(derivedVoucherCode ? { prepaidVoucherCode: derivedVoucherCode } : {}),
    ...(derivedVoucherPlatform
      ? { prepaidVoucherPlatform: derivedVoucherPlatform }
      : {}),
    ...(derivedVoucherFaceAmount !== undefined
      ? { prepaidVoucherFaceAmount: derivedVoucherFaceAmount }
      : {}),
    ...(prepaidGrouponCode ? { prepaidGrouponCode } : {}),
    ...(prepaidGrouponPlatform ? { prepaidGrouponPlatform } : {}),
    ...(prepaidNote ? { prepaidNote } : {}),
    ...(dto.prepaidAmount !== undefined
      ? { prepaidAmount: dto.prepaidAmount }
      : {}),
    ...(dto.commissionAssignments !== undefined
      ? {
          commissionAssignments: normalizeCommissionAssignmentsPayload(
            dto.commissionAssignments,
          ),
        }
      : {}),
  };
};

/** 开台提成分配收敛：丢弃非法行，名称 trim，服务名与技师名可缺省。 */
export const normalizeCommissionAssignmentsPayload = (
  assignments: CommissionAssignmentDto[],
): CommissionAssignmentInput[] =>
  assignments.flatMap((assignment): CommissionAssignmentInput[] => {
    const technicianName = assignment.technicianName?.trim();
    const serviceIds = [...new Set(assignment.serviceIds)];
    if (serviceIds.length === 0) {
      return [];
    }

    const serviceNames = Array.isArray(assignment.serviceNames)
      ? assignment.serviceNames.map((name) => name.trim())
      : [];

    return [
      {
        technicianId: assignment.technicianId,
        ...(technicianName ? { technicianName } : {}),
        serviceIds,
        ...(serviceNames.length > 0 ? { serviceNames } : {}),
        ...(assignment.commission !== undefined
          ? { commission: assignment.commission }
          : {}),
      },
    ];
  });

export const normalizeSessionItemsPayload = (
  items: Array<{
    productId: string;
    productName: string;
    categoryName: string;
    salePrice: number;
    profit: number;
    quantity: number;
  }>,
): SpaceSessionItemRecord[] => {
  if (items.length === 0) {
    throw new BadRequestException('请至少选择一件商品');
  }

  return items.map((item) => {
    const productId = item.productId.trim();
    const productName = item.productName.trim();
    const categoryName = item.categoryName.trim();

    if (!productId) {
      throw new BadRequestException('商品 ID 不能为空');
    }
    if (!productName) {
      throw new BadRequestException('商品名称不能为空');
    }
    if (!categoryName) {
      throw new BadRequestException('商品分类不能为空');
    }

    return {
      productId,
      productName,
      categoryName,
      salePrice: item.salePrice,
      profit: item.profit,
      quantity: item.quantity,
      lineTotal: Money.fromInputYuan(item.salePrice)
        .multiply(item.quantity)
        .toOutputYuan(),
    };
  });
};

export const normalizeRenewPayload = (
  dto: RenewSpaceSessionDto,
): NormalizedRenewPayload => {
  const grouponCode = dto.grouponCode?.trim();
  const grouponPlatform = dto.grouponPlatform?.trim();
  const note = dto.note?.trim();

  // Bug 2 fix: 金额精度校验，与结账链路保持一致（最多两位小数）
  assertMoneyPrecision(dto.amount, '续费金额');
  assertMoneyPrecision(dto.voucherFaceAmount, '券面金额');

  // Bug 7 fix: 续费金额上限校验
  if (dto.amount > RENEW_AMOUNT_MAX) {
    throw new BadRequestException(`续费金额不能超过 ${RENEW_AMOUNT_MAX} 元`);
  }
  if (
    dto.voucherFaceAmount !== undefined &&
    dto.voucherFaceAmount > RENEW_AMOUNT_MAX
  ) {
    throw new BadRequestException(`券面金额不能超过 ${RENEW_AMOUNT_MAX} 元`);
  }

  // Bug 3 fix: 团购字段交叉校验，与结账链路保持一致
  const isGrouponPayment = dto.paymentMethod === 'groupon_voucher';
  const hasAnyGrouponField = !!(
    grouponCode ||
    grouponPlatform ||
    dto.voucherFaceAmount
  );

  // B3/B5 fix: 团购字段出现时强制 paymentMethod 为 groupon_voucher，
  // 确保校验层与回写层口径一致，防止：
  //   ① prepaid* 标记不回写 → 自动结账跳过 → 空间永久占用（B3）
  //   ② 非团购支付 + voucherFaceAmount 放大加钟/抵扣（B5）
  const effectivePaymentMethod =
    hasAnyGrouponField && !isGrouponPayment
      ? ('groupon_voucher' as typeof dto.paymentMethod)
      : dto.paymentMethod;

  if (isGrouponPayment || hasAnyGrouponField) {
    if (!grouponCode) {
      throw new BadRequestException('团购券码不能为空');
    }
    if (!grouponPlatform) {
      throw new BadRequestException('团购平台不能为空');
    }
    if (dto.voucherFaceAmount === undefined || dto.voucherFaceAmount <= 0) {
      throw new BadRequestException('券面金额必须大于 0');
    }
    // G4 fix: 团购场景下实付金额不应超过券面金额，
    // 否则 max(amount, voucherFaceAmount) 会放大为 amount，导致多加钟/多抵扣
    if (dto.amount > dto.voucherFaceAmount) {
      throw new BadRequestException(
        '续费金额不能超过券面金额（团购券规则：实付 ≤ 券面）',
      );
    }
  }

  return {
    amount: dto.amount,
    paymentMethod: effectivePaymentMethod,
    ...(grouponCode ? { grouponCode } : {}),
    ...(grouponPlatform ? { grouponPlatform } : {}),
    ...(dto.voucherFaceAmount !== undefined
      ? { voucherFaceAmount: dto.voucherFaceAmount }
      : {}),
    ...(note ? { note } : {}),
  };
};
