// 团购券订单聚合服务：对外编排创建/列表/详情/核销/退款/支付确认
import { Injectable } from '@nestjs/common';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import { ClubVoucherOrderPaymentService } from './club-voucher-order-payment.service';
import { ClubVoucherOrderQueryService } from './club-voucher-order-query.service';
import { ClubVoucherOrderRefundService } from './club-voucher-order-refund.service';
import { ClubVoucherOrderVerifyService } from './club-voucher-order-verify.service';
import type {
  ClubVoucherOrderDetailDto,
  ClubVoucherOrderListResponseDto,
  ClubVoucherOrderPreviewResponseDto,
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
  PreviewClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 团购券订单状态码（前端可直接使用） */
export const CLUB_VOUCHER_STATUS_PENDING = 'pending';
export const CLUB_VOUCHER_STATUS_USED = 'used';
export const CLUB_VOUCHER_STATUS_REFUNDED = 'refunded';
export const CLUB_VOUCHER_STATUS_EXPIRED = 'expired';

@Injectable()
export class ClubVoucherOrdersService {
  constructor(
    private readonly contextService: ClubVoucherOrderContextService,
    private readonly paymentService: ClubVoucherOrderPaymentService,
    private readonly queryService: ClubVoucherOrderQueryService,
    private readonly verifyService: ClubVoucherOrderVerifyService,
    private readonly refundService: ClubVoucherOrderRefundService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
  ) {}

  /** 预计算团购券订单价格（不创建订单） */
  async previewVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: PreviewClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderPreviewResponseDto> {
    const context = await this.contextService.resolveContext(
      currentContext,
      dto,
    );
    const quantity = dto.quantity ?? 1;
    const personCount = dto.personCount ?? context.product.personCount ?? 1;
    const pricing = await this.contextService.resolvePricing(
      context,
      quantity,
      dto.usePoints === true,
    );
    // 优惠拆解展示行：与服务商品 preview 同口径（会员售价/等级折扣划线/活动折扣/满减/小计）
    const breakdownItems = this.breakdownService.build({
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
    return {
      originalAmountFen: pricing.originalAmountFen,
      discountAmountFen: pricing.discountAmountFen,
      paidAmountFen: pricing.paidAmountFen,
      pointsDeductFen: pricing.pointsDeductFen,
      pointsUsed: pricing.pointsUsed,
      personCount,
      balanceEnough: true,
      memberAmountFen: pricing.memberAmountFen,
      afterDiscountAmountFen: pricing.afterDiscountAmountFen,
      reduceFen: pricing.reduceFen,
      promotionDiscountFen: pricing.promotionDiscountFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      memberDiscountRate: pricing.memberDiscountRate,
      breakdownItems,
    };
  }

  /** 创建团购券订单草稿（支付成功后生成券码） */
  createVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderResponseDto> {
    return this.paymentService.createVoucherOrder(currentContext, dto);
  }

  /** 确认支付成功（开发态兜底） */
  async confirmVoucherOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderResponseDto> {
    const draft = await this.paymentService.confirmOrderPaid(
      currentContext,
      orderNo,
    );
    return {
      id: draft.id,
      orderNo: draft.orderNo,
      voucherCode: draft.voucherCode ?? undefined,
      status: draft.status,
      amountFen: draft.amountFen,
    };
  }

  /** 微信回调确认支付成功（按订单号路由） */
  async confirmVoucherOrderPaidByCallback(
    orderNo: string,
    params: { amountFen: number; transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderResponseDto & { orderType: 'voucher' }> {
    const draft = await this.paymentService.confirmOrderPaidByCallback(
      orderNo,
      params,
    );
    return {
      id: draft.id,
      orderNo: draft.orderNo,
      orderType: 'voucher',
      voucherCode: draft.voucherCode ?? undefined,
      status: draft.status,
      amountFen: draft.amountFen,
    };
  }

  /** 我的团购券订单列表 */
  listVoucherOrders(
    currentContext: ClubCurrentContext,
    query: { status?: string; limit?: number; offset?: number },
  ): Promise<ClubVoucherOrderListResponseDto> {
    return this.queryService.listVoucherOrders(currentContext, query);
  }

  /** 团购券订单详情 */
  getVoucherOrderDetail(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderDetailDto> {
    return this.queryService.getVoucherOrderDetail(currentContext, orderNo);
  }

  /** 用户端立即核销 */
  verifyVoucherOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<{ orderNo: string; status: 'used'; verifyAt: string }> {
    return this.verifyService.verifyVoucherOrder(currentContext, orderNo);
  }

  /** 用户端退款 */
  refundVoucherOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<{
    orderNo: string;
    status: 'refunded';
    refundAt: string;
    refundAmountFen: number;
  }> {
    return this.refundService.refundVoucherOrder(currentContext, orderNo);
  }
}
