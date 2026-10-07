// 团购券订单上下文解析与金额预计算：商品/门店/顾客校验 + 活动优惠 + 积分抵扣（金额全部后端计算）
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderPromotionsService } from '../orders/club-order-promotions.service';
import { resolvePointsDeduction } from '../orders/club-order-points.utils';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_PRODUCT_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_PRODUCT_NOT_VOUCHER_MESSAGE,
} from './club-voucher-orders.constants';

/** 团购券下单上下文（门店/顾客/商品摘要） */
export interface ClubVoucherOrderContext {
  store: { id: number; name: string };
  /** 顾客档案（balance：储值余额，分；用于余额支付充足性判断） */
  customer: { id: number; balance: number };
  /** 当前登录者 ID（会员等级折扣的顾客档案定位用，两层锚定的权威层） */
  clubUserId: number;
  /** 用户手机号（会员等级折扣率查询用，作为锚点落空时的无主档案认领依据） */
  phone: string;
  product: {
    id: number;
    name: string;
    /** 商品分类名（团购券类型，如小包/中包；下单时快照到订单） */
    categoryName: string | null;
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
  /** 生效满减规则（门槛分/减免分），用于生成“满xxx减xxx”标签 */
  reduceRules: Array<{ thresholdFen: number; reduceAmountFen: number }>;
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
  /** 会员等级折扣是否在竞争中胜出（活动被覆盖）；true 时活动行划线展示 */
  memberWins: boolean;
}

@Injectable()
export class ClubVoucherOrderContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
  ) {}

  /**
   * 定位**当前登录者本人**在本店的顾客档案。
   *
   * 两步都不能少，顺序也不能反：
   *
   * 1. `(storeId, clubUserId)` —— 权威锚点。账号与档案一一对应，不受手机号变化
   *    （换绑后旧号可能被他人注册）影响。
   * 2. 锚点落空才降级到手机号，且**必须限定该档案 `clubUserId` 为 null**。
   *
   * 第 2 步的 null 限定是关键：同一门店可能存在两条相同手机号的档案，其中一条
   * 属于他人。不限定的话 `findFirst` 命中哪条并不确定，会把别人的储值余额当成
   * 自己的。宁可让无主档案继续无主，也不能认错人。
   *
   * 兜底面向的是历史无主档案（早期建档未写入 clubUserId 的那一批），
   * 新数据都会带 clubUserId，终态会全部收敛到第 1 步。
   */
  private async resolveOwnCustomer(params: {
    storeId: number;
    clubUserId: number;
    phone: string;
  }): Promise<{ id: number; balance: number } | null> {
    const bound = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId: params.storeId,
        clubUserId: params.clubUserId,
        deletedAt: null,
      },
      select: { id: true, balance: true },
    });
    if (bound) {
      return bound;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: {
        storeId: params.storeId,
        phone: params.phone,
        clubUserId: null,
        deletedAt: null,
      },
      select: { id: true, balance: true },
    });
  }

  /** 校验当前门店与下单门店一致，并加载团购券商品（type=voucher）与顾客档案 */
  async resolveContext(
    currentContext: ClubVoucherOrderContextInput,
    dto: { storeId: number; productId: number },
  ): Promise<ClubVoucherOrderContext> {
    if (currentContext.store.id !== dto.storeId) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }

    const [customer, product] = await Promise.all([
      this.resolveOwnCustomer({
        storeId: currentContext.store.id,
        clubUserId: currentContext.user.id,
        phone: currentContext.user.phone,
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
          // 分类名快照：商家端查看订单页展示“类型（如小包/中包）”
          category: { select: { name: true } },
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
      clubUserId: currentContext.user.id,
      phone: currentContext.user.phone,
      product: {
        id: product.id,
        name: product.name,
        categoryName: product.category?.name ?? null,
        price: product.price,
        originalPrice: product.originalPrice,
        image: product.image,
        stock: product.stock,
        personCount: product.personCount,
        validDays: product.validDays,
      },
    };
  }

  /** 计算团购券订单金额：原价 → 活动/会员折扣竞争 → 满减 → 积分抵扣，全部由后端权威计算 */
  async resolvePricing(
    context: ClubVoucherOrderContext,
    quantity: number,
    usePoints: boolean,
  ): Promise<ClubVoucherPricing> {
    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      context.product.price,
      { skipReduce: true },
    );
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        context.clubUserId,
        context.phone,
      );
    // 竞争模型（与 purelyClub 服务订单预览一致）：会员等级折扣 vs 活动折扣，取更低者生效
    const effectiveMemberRate =
      memberDiscountRate != null && memberDiscountRate < 1
        ? memberDiscountRate
        : 1;
    const memberPriceFen = Math.round(
      context.product.price * effectiveMemberRate,
    );
    const activityPriceFen = pricing.amountFenBeforeReduce;
    const memberWins =
      effectiveMemberRate < 1 && memberPriceFen <= activityPriceFen;
    const bestPriceFen = Math.min(memberPriceFen, activityPriceFen);
    const beforeReduceTotalFen = bestPriceFen * quantity;
    const reduceDetail =
      await this.clubOrderPromotionsService.resolveOrderReduceDetail(
        context.store.id,
        beforeReduceTotalFen,
      );
    const orderReduceFen = reduceDetail.totalReduceFen;
    const afterReduceTotalFen = Math.max(
      beforeReduceTotalFen - orderReduceFen,
      0,
    );

    const { pointsDeductFen, pointsUsed } = await resolvePointsDeduction(
      this.prisma,
      context.store.id,
      context.customer.id,
      afterReduceTotalFen,
      usePoints,
    );
    const paidAmountFen = Math.max(afterReduceTotalFen - pointsDeductFen, 0);

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
      reduceRules: reduceDetail.reduceRules,
      promotionDiscountFen: pricing.promotionDiscountAmountFen * quantity,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      memberDiscountRate,
      memberWins,
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
}
