// 团购券订单上下文解析与金额预计算：商品/门店/顾客校验 + 活动优惠 + 积分抵扣（金额全部后端计算）
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderPromotionsService } from '../orders/club-order-promotions.service';
import {
  fetchPointsRedeemConfig,
  calcPointsRedeemDetail,
} from '../orders/club-order-points.utils';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_PRODUCT_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_PRODUCT_NOT_VOUCHER_MESSAGE,
} from './club-voucher-orders.constants';

/** 团购券下单上下文（门店/顾客/商品摘要） */
export interface ClubVoucherOrderContext {
  store: { id: number; name: string };
  customer: { id: number };
  /** 用户手机号（会员等级折扣率查询用） */
  phone: string;
  product: {
    id: number;
    name: string;
    price: number;
    originalPrice: number | null;
    image: string | null;
    stock: number;
    personCount: number | null;
    validDays: number | null;
  };
}

/** 团购券下单上下文解析入参（controller 传入完整 ClubCurrentContext，兼容子集结构） */
export interface ClubVoucherOrderContextInput {
  user: AuthenticatedUser;
  store: { id: number; name: string };
}

/** 团购券订单金额拆解（全部后端计算） */
export interface ClubVoucherPricing {
  /** 应付金额（分，原价口径） */
  originalAmountFen: number;
  /** 优惠金额（分）= 活动优惠 × 数量 + 整单满减 + 积分抵扣 */
  discountAmountFen: number;
  /** 实付金额（分） */
  paidAmountFen: number;
  /** 积分抵扣金额（分） */
  pointsDeductFen: number;
  /** 实际扣减积分个数 */
  pointsUsed: number;
  /** 会员价小计（分）= 商品会员价 × 数量 */
  memberAmountFen: number;
  /** 活动折后小计（分，满减前） */
  afterDiscountAmountFen: number;
  /** 整单满减金额（分） */
  reduceFen: number;
  /** 活动折扣优惠金额（分，单价活动折扣 × 数量） */
  promotionDiscountFen: number;
  /** 命中活动类型 */
  promotionType: string | null;
  /** 命中活动标签 */
  promotionTag: string | null;
  /** 命中活动折扣率（0-100 整数，如 75 表示 7.5 折） */
  discountRate: number | null;
  /** 会员等级折扣率（0-1 小数，无折扣为 null） */
  memberDiscountRate: number | null;
}

@Injectable()
export class ClubVoucherOrderContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
  ) {}

  /** 校验当前门店与下单门店一致，并加载团购券商品（type=voucher）与顾客档案 */
  async resolveContext(
    currentContext: ClubVoucherOrderContextInput,
    dto: { storeId: number; productId: number },
  ): Promise<ClubVoucherOrderContext> {
    if (currentContext.store.id !== dto.storeId) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }

    const [customer, product] = await Promise.all([
      this.prisma.marketingCustomer.findFirst({
        where: {
          storeId: currentContext.store.id,
          phone: currentContext.user.phone,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.marketingProduct.findFirst({
        where: {
          id: dto.productId,
          storeId: currentContext.store.id,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          price: true,
          originalPrice: true,
          image: true,
          stock: true,
          personCount: true,
          validDays: true,
          type: true,
        },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE);
    }
    if (!product) {
      throw new NotFoundException(CLUB_VOUCHER_PRODUCT_NOT_FOUND_MESSAGE);
    }
    if (product.type !== 'voucher') {
      throw new BadRequestException(CLUB_VOUCHER_PRODUCT_NOT_VOUCHER_MESSAGE);
    }

    return {
      store: {
        id: currentContext.store.id,
        name: currentContext.store.name,
      },
      customer,
      phone: currentContext.user.phone,
      product,
    };
  }

  /** 计算团购券订单金额：原价 → 活动/满减 → 积分抵扣，全部由后端权威计算 */
  async resolvePricing(
    context: ClubVoucherOrderContext,
    quantity: number,
    usePoints: boolean,
  ): Promise<ClubVoucherPricing> {
    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      context.phone,
      context.product.price,
      { skipReduce: true },
    );
    const beforeReduceTotalFen = pricing.amountFenBeforeReduce * quantity;
    const orderReduceFen =
      await this.clubOrderPromotionsService.resolveOrderReduceFen(
        context.store.id,
        beforeReduceTotalFen,
      );
    const afterReduceTotalFen = Math.max(
      beforeReduceTotalFen - orderReduceFen,
      0,
    );

    const { pointsDeductFen, pointsUsed } = await this.calcPointsDeduction(
      context.store.id,
      context.customer.id,
      afterReduceTotalFen,
      usePoints,
    );
    const paidAmountFen = Math.max(afterReduceTotalFen - pointsDeductFen, 0);
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        context.phone,
      );

    return {
      originalAmountFen:
        (context.product.originalPrice ?? context.product.price) * quantity,
      discountAmountFen:
        pricing.discountAmountFen * quantity + orderReduceFen + pointsDeductFen,
      paidAmountFen,
      pointsDeductFen,
      pointsUsed,
      memberAmountFen: context.product.price * quantity,
      afterDiscountAmountFen: beforeReduceTotalFen,
      reduceFen: orderReduceFen,
      promotionDiscountFen: pricing.promotionDiscountAmountFen * quantity,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      memberDiscountRate,
    };
  }

  /** 查询商品实时库存（支付确认/退款回补时以商品当前库存为准） */
  async findProductStock(tx: Prisma.TransactionClient, productId: number) {
    return tx.marketingProduct.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        price: true,
        originalPrice: true,
        stock: true,
      },
    });
  }

  private async calcPointsDeduction(
    storeId: number,
    customerId: number,
    priceAfterDiscountFen: number,
    usePoints: boolean,
  ): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
    if (!usePoints || priceAfterDiscountFen <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }
    const pointsConfig = await fetchPointsRedeemConfig(this.prisma, storeId);
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });
    const availablePoints = customer?.points ?? 0;
    return calcPointsRedeemDetail(
      priceAfterDiscountFen,
      pointsConfig,
      availablePoints,
    );
  }
}
