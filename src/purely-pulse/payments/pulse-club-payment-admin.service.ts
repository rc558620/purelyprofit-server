/**
 * 管理端（平台运营）人工补单服务（D8）。
 *
 * 面向「钱已扣、余额未到账」这类必须人工介入的事故：
 *   - 按订单号同时看本地状态与微信侧真实状态，判断到底有没有扣款；
 *   - 微信侧已支付、本地未落账时，直接复用充值落账链路补单；
 *   - 死信列表给出待处理清单，处理完标记 resolved 并留操作人与备注。
 *
 * ⚠️ 本服务只读本地订单表用于展示，不调用任何「手动确认支付」通道：
 * 补单必须以微信侧真实支付结果为准，否则等于开放了凭空加余额的口子。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit-log.service';
import { ClubPaymentCallbackFailureService } from '../../purely-club/payments/club-payment-callback-failure.service';
import { ClubWechatTransactionService } from '../../purely-club/payments/club-wechat-transaction.service';
import { ClubRechargeWechatVerifyService } from '../../purely-club/recharge/club-recharge-wechat-verify.service';
import type {
  PulseClubCallbackFailureItemDto,
  PulseClubRechargeOrderInspectDto,
} from './dto/pulse-club-payment-admin.dto';

@Injectable()
export class PulseClubPaymentAdminService {
  private readonly logger = new Logger(PulseClubPaymentAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly failureService: ClubPaymentCallbackFailureService,
    private readonly transactionService: ClubWechatTransactionService,
    private readonly verifyService: ClubRechargeWechatVerifyService,
  ) {}

  /** 按订单号体检：本地状态 + 微信侧状态，不做任何写操作 */
  async inspectRechargeOrder(
    orderNo: string,
  ): Promise<PulseClubRechargeOrderInspectDto> {
    const local = await this.loadLocalOrder(orderNo);
    const wechat = local
      ? await this.transactionService.queryByOutTradeNo({
          storeId: local.storeId,
          orderNo,
        })
      : null;

    return {
      orderNo,
      localStatus: local?.status ?? null,
      localAmountFen: local?.amountFen ?? null,
      wechatTradeState: wechat?.found ? wechat.snapshot.tradeState : null,
      wechatTransactionId: wechat?.found ? wechat.snapshot.transactionId : null,
      wechatAmountFen: wechat?.found ? wechat.snapshot.amountFen : null,
      settled: false,
      statusAfterRetry: null,
    };
  }

  /** 人工补单：回微信核对，已支付且本地未落账则补落账 */
  async retryRechargeOrder(params: {
    orderNo: string;
    operatorId: number;
  }): Promise<PulseClubRechargeOrderInspectDto> {
    const before = await this.loadLocalOrder(params.orderNo);
    const result = await this.verifyService.verifyAndSettle({
      orderNo: params.orderNo,
      force: true,
    });

    const settled = result.status === 'paid';
    this.logger.log(
      `[人工补单] orderNo=${params.orderNo} 操作人=${params.operatorId} ` +
        `补单前=${before?.status ?? 'unknown'} 补单后=${result.status}`,
    );
    this.auditLogService.record({
      userId: params.operatorId,
      action: 'club.recharge.manual_retry_settle',
      resourceType: 'club_recharge_order',
      resourceId: params.orderNo,
      metadata: {
        statusBefore: before?.status ?? null,
        statusAfter: result.status,
        settled,
      },
    });

    return {
      ...(await this.inspectRechargeOrder(params.orderNo)),
      settled,
      statusAfterRetry: result.status,
    };
  }

  /** 死信列表 */
  async listCallbackFailures(params: {
    status?: string;
    limit?: number;
  }): Promise<PulseClubCallbackFailureItemDto[]> {
    return this.failureService.list(params);
  }

  /** 标记死信已处理 */
  async resolveCallbackFailure(params: {
    id: number;
    status: 'resolved' | 'ignore';
    note?: string;
    operatorId: number;
  }): Promise<PulseClubCallbackFailureItemDto> {
    const resolved = await this.failureService.resolve(params);

    this.auditLogService.record({
      userId: params.operatorId,
      action: 'club.payment_callback_failure.resolve',
      resourceType: 'club_payment_callback_failure',
      resourceId: String(params.id),
      metadata: { status: params.status, orderNo: resolved.orderNo },
    });
    return resolved;
  }

  private loadLocalOrder(orderNo: string): Promise<{
    storeId: number;
    status: string;
    amountFen: number;
  } | null> {
    return this.prisma.clubRechargeOrder.findUnique({
      where: { orderNo },
      select: { storeId: true, status: true, amountFen: true },
    });
  }
}
