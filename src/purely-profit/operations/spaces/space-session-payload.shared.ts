import { BadRequestException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type {
  OpenSpaceSessionDto,
  RenewSpaceSessionDto,
} from './dto/space-session.dto';
import type {
  NormalizedOpenSessionPayload,
  NormalizedRenewPayload,
  SpaceSessionItemRecord,
} from './space-sessions.types';

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
    dto.prepaidVoucherFaceAmount ?? dto.prepaidAmount;
  const derivedCustomerPaymentMethod =
    dto.prepaidCustomerPaymentMethod ??
    (derivedVoucherCode || derivedVoucherPlatform
      ? ('groupon_voucher' as const)
      : dto.prepaidPaymentMethod);
  const derivedSettlementChannel =
    dto.prepaidSettlementChannel ??
    (derivedCustomerPaymentMethod === 'groupon_voucher'
      ? (() => {
          const normalized = derivedVoucherPlatform?.trim().toLowerCase();
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
  };
};

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

  return {
    amount: dto.amount,
    paymentMethod: dto.paymentMethod,
    ...(grouponCode ? { grouponCode } : {}),
    ...(grouponPlatform ? { grouponPlatform } : {}),
    ...(dto.voucherFaceAmount !== undefined
      ? { voucherFaceAmount: dto.voucherFaceAmount }
      : {}),
    ...(note ? { note } : {}),
  };
};
