// 团购券订单支付服务：创建订单草稿（JSAPI 下单）→ 支付成功确认（生成券码 + 扣库存 + 起算有效期）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import {
  buildVoucherCode,
  buildVoucherOrderNo,
} from './club-voucher-order-code.utils';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE,
} from './club-voucher-orders.constants';
import {
  CLUB_VOUCHER_DEFAULT_VALID_DAYS,
  CLUB_VOUCHER_GUEST_TYPE,
  CLUB_VOUCHER_PLATFORM,
} from './club-voucher-orders.types';
import type {
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 券码唯一冲突重试次数（唯一索引兜底，碰撞概率极低） */
const VOUCHER_CODE_RETRY_TIMES = 3;

/** 团购券订单状态字面量（与 Prisma 枚举同构，避免依赖 client 枚举导出） */
type VoucherOrderStatus =
  | 'unpaid'
  | 'pending'
  | 'used'
  | 'refunded'
  | 'expired';

/** 团购券订单草稿（unpaid）→ 响应结构 */
export interface ClubVoucherOrderDraftView {
  id: string;
  orderNo: string;
  status: VoucherOrderStatus;
  /** 支付成功后的团购券码 */
  voucherCode: string | null;
  amountFen: number;
  paymentParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
}

@Injectable()
export class ClubVoucherOrderPaymentService {
  private readonly logger = new Logger(ClubVoucherOrderPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubVoucherOrderContextService: ClubVoucherOrderContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
  ) {}

  /** 创建团购券订单草稿：校验商品/算价 → JSAPI 下单 → 落库 unpaid */
  async createVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderResponseDto> {
    const context = await this.clubVoucherOrderContextService.resolveContext(
      currentContext,
      dto,
    );
    const quantity = dto.quantity ?? 1;
    const personCount = dto.personCount ?? context.product.personCount ?? 1;
    const pricing = await this.clubVoucherOrderContextService.resolvePricing(
      context,
      quantity,
      dto.usePoints === true,
    );

    if (context.product.stock < quantity) {
      throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
    }

    const now = Date.now();
    const orderNo = buildVoucherOrderNo(now);

    // 优惠拆解快照：与服务商品 preview 同口径（会员售价/等级折扣划线/活动折扣/满减/小计），
    // 订单详情页优惠清单在此基础上补充：原价行（划线）与积分抵扣行（订单使用积分时展示）
    const baseBreakdownItems = this.breakdownService.build({
      memberBaselineFen: pricing.memberAmountFen,
      originalPriceFen: pricing.originalAmountFen,
      discountAmountFen: pricing.discountAmountFen,
      promotionDiscountAmountFen: pricing.promotionDiscountFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: pricing.reduceFen,
      finalPriceFen: pricing.paidAmountFen + pricing.pointsDeductFen,
      memberDiscountRate: pricing.memberDiscountRate,
    });
    const toYuanText = (fen: number): string =>
      Money.fromDbCents(fen).toFixedOutputYuan();
    const breakdownItems = [
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

    // 微信 JSAPI 真实下单；openid 未传时开发态直接返回草稿（前端可走 confirmPaid 兜底）
    const paymentParams = dto.openid
      ? await this.clubWechatJsapiService.createJsapiPaymentParams({
          storeId: context.store.id,
          orderNo,
          description: `购买${context.product.name}`,
          amountFen: pricing.paidAmountFen,
          openid: dto.openid,
        })
      : undefined;

    await this.prisma.clubVoucherOrder.create({
      data: {
        platform: CLUB_VOUCHER_PLATFORM,
        storeId: context.store.id,
        userId: currentContext.user.id,
        customerId: context.customer.id,
        productId: context.product.id,
        productName: context.product.name,
        productPrice: context.product.price,
        productOriginalPrice: context.product.originalPrice,
        quantity,
        personCount,
        guestName: currentContext.user.name?.trim() || null,
        guestPhone: currentContext.user.phone,
        guestType: CLUB_VOUCHER_GUEST_TYPE,
        orderNo,
        originalAmountFen: pricing.originalAmountFen,
        // 完整优惠口径 = 应付（原价） - 实付（含会员价差/活动/满减/积分），与服务详情页“共省”一致
        discountAmountFen: Math.max(
          pricing.originalAmountFen - pricing.paidAmountFen,
          0,
        ),
        paidAmountFen: pricing.paidAmountFen,
        breakdownItems: breakdownItems as unknown as Prisma.InputJsonValue,
        pointsDeductFen: pricing.pointsDeductFen,
        pointsUsed: pricing.pointsUsed,
        paymentChannel: 'wechat',
        status: 'unpaid',
      },
    });

    return {
      id: orderNo,
      orderNo,
      status: 'unpaid',
      amountFen: pricing.paidAmountFen,
      paymentParams,
    };
  }

  /** 用户端确认支付成功（开发态兜底）：unpaid → pending + 生成券码 + 扣库存 */
  async confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    return this.completePayment(order.id, order.paidAmountFen, undefined);
  }

  /** 微信回调确认支付成功：按订单号路由，校验金额后完成落账 */
  async confirmOrderPaidByCallback(
    orderNo: string,
    params: { amountFen: number; transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findUnique({
      where: { orderNo },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    if (order.paidAmountFen !== params.amountFen) {
      throw new BadRequestException('回调金额与订单金额不一致');
    }
    return this.completePayment(order.id, order.paidAmountFen, params);
  }

  /**
   * 支付完成事务：unpaid → pending，生成唯一券码，扣减库存，起算有效期
   * 幂等：已 pending/used 的订单重复确认直接返回，不重复扣库存
   */
  private async completePayment(
    orderId: number,
    expectedAmountFen: number,
    params?: { transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.clubVoucherOrder.findUnique({
          where: { id: orderId },
        });
        if (!order) {
          throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
        }
        if (order.paidAmountFen !== expectedAmountFen) {
          throw new BadRequestException('订单金额不一致');
        }
        // 幂等：已确认支付（pending/used/refunded/expired）直接返回现状
        if (order.status !== 'unpaid') {
          return this.toDraftView(order);
        }

        const product = await tx.marketingProduct.findUnique({
          where: { id: order.productId },
          select: { stock: true, validDays: true },
        });
        if (!product || product.stock < order.quantity) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 扣库存（行级条件更新，防止超卖）
        const decremented = await tx.marketingProduct.updateMany({
          where: { id: order.productId, stock: { gte: order.quantity } },
          data: { stock: { decrement: order.quantity } },
        });
        if (decremented.count !== 1) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 生成唯一券码（碰撞重试）
        const voucherCode = await this.generateUniqueVoucherCode(tx);

        const validDays = product.validDays ?? CLUB_VOUCHER_DEFAULT_VALID_DAYS;
        const paidAt = params?.paidAtMs
          ? new Date(params.paidAtMs)
          : new Date();

        const updated = await tx.clubVoucherOrder.update({
          where: { id: orderId },
          data: {
            voucherCode,
            status: 'pending',
            transactionId: params?.transactionId ?? null,
            expiresAt: new Date(
              paidAt.getTime() + validDays * 24 * 60 * 60 * 1000,
            ),
          },
        });

        this.logger.log(
          `团购券订单支付成功: orderNo=${order.orderNo}, voucherCode=${voucherCode}, 有效期${validDays}天`,
        );
        return this.toDraftView(updated);
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  /** 生成全局唯一券码（唯一索引冲突时重试） */
  private async generateUniqueVoucherCode(
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

  /** 订单实体 → 草稿响应（金额单位分 → 元） */
  private toDraftView(order: {
    id: number;
    orderNo: string;
    status: VoucherOrderStatus;
    voucherCode: string | null;
    paidAmountFen: number;
  }): ClubVoucherOrderDraftView {
    return {
      id: order.orderNo,
      orderNo: order.orderNo,
      status: order.status,
      voucherCode: order.voucherCode,
      amountFen: order.paidAmountFen,
    };
  }
}
