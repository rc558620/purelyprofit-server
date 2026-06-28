import { BadRequestException } from '@nestjs/common';
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
    ...(dto.prepaidCustomerPaymentMethod !== undefined
      ? { prepaidCustomerPaymentMethod: dto.prepaidCustomerPaymentMethod }
      : {}),
    ...(dto.prepaidSettlementChannel !== undefined
      ? { prepaidSettlementChannel: dto.prepaidSettlementChannel }
      : {}),
    ...(prepaidGrouponCode ? { prepaidGrouponCode } : {}),
    ...(prepaidGrouponPlatform ? { prepaidGrouponPlatform } : {}),
    ...(prepaidVoucherCode ? { prepaidVoucherCode } : {}),
    ...(prepaidVoucherPlatform ? { prepaidVoucherPlatform } : {}),
    ...(prepaidNote ? { prepaidNote } : {}),
    ...(dto.prepaidAmount !== undefined
      ? { prepaidAmount: dto.prepaidAmount }
      : {}),
    ...(dto.prepaidVoucherFaceAmount !== undefined
      ? { prepaidVoucherFaceAmount: dto.prepaidVoucherFaceAmount }
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
