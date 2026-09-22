// 团购券订单支付链路辅助：优惠拆解行组装 / 草稿订单落库入参 / 唯一券码生成 / 草稿视图映射
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import type { ClubOrderBreakdownItemDto } from '../orders/dto/club-order.dto';
import type { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import type {
  ClubVoucherOrderContext,
  ClubVoucherPricing,
} from './club-voucher-order-context.service';
import { buildVoucherCode } from './club-voucher-order-code.utils';
import {
  CLUB_VOUCHER_GUEST_TYPE,
  CLUB_VOUCHER_PLATFORM,
} from './club-voucher-orders.types';
import {
  VOUCHER_CODE_RETRY_TIMES,
  type ClubVoucherOrderDraftView,
  type VoucherOrderDraftRow,
} from './club-voucher-order-payment.types';

/** 分 → 元文本（优惠拆解行文案用） */
const toYuanText = (fen: number): string =>
  Money.fromDbCents(fen).toFixedOutputYuan();

/**
 * 优惠拆解快照：与服务商品 preview 同口径（会员售价/等级折扣划线/活动折扣/满减/小计），
 * 订单详情页优惠清单在此基础上补充：原价行（划线）与积分抵扣行（订单使用积分时展示）
 */
export function buildVoucherOrderBreakdownItems(
  breakdownService: ClubOrderPreviewBreakdownService,
  pricing: ClubVoucherPricing,
): ClubOrderBreakdownItemDto[] {
  const baseBreakdownItems = breakdownService.build({
    memberBaselineFen: pricing.memberAmountFen,
    originalPriceFen: pricing.originalAmountFen,
    discountAmountFen: pricing.discountAmountFen,
    promotionDiscountAmountFen: pricing.promotionDiscountFen,
    promotionType: pricing.promotionType,
    promotionTag: pricing.promotionTag,
    discountRate: pricing.discountRate,
    totalReduceFen: pricing.reduceFen,
    reduceRules: pricing.reduceRules,
    finalPriceFen: pricing.paidAmountFen + pricing.pointsDeductFen,
    memberDiscountRate: pricing.memberDiscountRate,
    memberWins: pricing.memberWins,
  });

  return [
    // 原价行：划线表示原价已被会员价/活动覆盖
    {
      id: 'original-price',
      label: '原价',
      value: `¥${toYuanText(pricing.originalAmountFen)}`,
      isDeduction: false,
      isStrikethrough: true,
    },
    ...baseBreakdownItems,
    // 积分抵扣行：仅订单使用积分时展示（预览页积分由开关控制，不写入快照）
    ...(pricing.pointsDeductFen > 0
      ? [
          {
            id: 'points',
            label: '积分抵扣',
            value: `-¥${toYuanText(pricing.pointsDeductFen)}`,
            isDeduction: true,
            isStrikethrough: false,
          },
        ]
      : []),
  ];
}

/** 草稿订单落库入参（商品/顾客/金额均在下单时快照） */
export interface BuildVoucherOrderCreateInputParams {
  orderNo: string;
  storeId: number;
  userId: number;
  customerId: number;
  product: ClubVoucherOrderContext['product'];
  /** 下单用户昵称（空串归一为 null） */
  guestName?: string | null;
  guestPhone?: string | null;
  quantity: number;
  personCount: number;
  /** 下单备注（仅去除首尾空白，空串归一为 null；商家端通知按空值不展示） */
  remark?: string | null;
  pricing: ClubVoucherPricing;
  breakdownItems: ClubOrderBreakdownItemDto[];
  paymentMethod: 'wechat' | 'balance';
}

/** 组装 unpaid 草稿订单的落库入参 */
export function buildVoucherOrderCreateInput(
  params: BuildVoucherOrderCreateInputParams,
): Prisma.ClubVoucherOrderUncheckedCreateInput {
  return {
    platform: CLUB_VOUCHER_PLATFORM,
    storeId: params.storeId,
    userId: params.userId,
    customerId: params.customerId,
    productId: params.product.id,
    productName: params.product.name,
    categoryName: params.product.categoryName,
    productPrice: params.product.price,
    productOriginalPrice: params.product.originalPrice,
    quantity: params.quantity,
    personCount: params.personCount,
    guestName: params.guestName?.trim() || null,
    guestPhone: params.guestPhone ?? null,
    remark: params.remark?.trim() || null,
    guestType: CLUB_VOUCHER_GUEST_TYPE,
    orderNo: params.orderNo,
    originalAmountFen: params.pricing.originalAmountFen,
    // 完整优惠口径 = 应付（原价） - 实付（含会员价差/活动/满减/积分），与服务详情页“共省”一致
    discountAmountFen: Math.max(
      params.pricing.originalAmountFen - params.pricing.paidAmountFen,
      0,
    ),
    paidAmountFen: params.pricing.paidAmountFen,
    breakdownItems: params.breakdownItems as unknown as Prisma.InputJsonValue,
    pointsDeductFen: params.pricing.pointsDeductFen,
    pointsUsed: params.pricing.pointsUsed,
    paymentChannel: params.paymentMethod,
    status: 'unpaid',
  };
}

/** 生成全局唯一券码（唯一索引冲突时重试） */
export async function generateUniqueVoucherCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < VOUCHER_CODE_RETRY_TIMES; attempt += 1) {
    const candidate = buildVoucherCode();
    const existing = await tx.clubVoucherOrder.findUnique({
      where: { voucherCode: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }
  throw new BadRequestException('券码生成失败，请重试');
}

/** 订单实体 → 草稿响应（订单号作为草稿态 id） */
export function toVoucherOrderDraftView(
  order: VoucherOrderDraftRow,
): ClubVoucherOrderDraftView {
  return {
    id: order.orderNo,
    orderNo: order.orderNo,
    status: order.status,
    voucherCode: order.voucherCode,
    amountFen: order.paidAmountFen,
  };
}
