/**
 * 微信支付回调落账死信服务（D8）。
 *
 * 回调队列重试耗尽后，此前只有一行日志：没人会事后翻日志，结果是
 * 用户投诉「钱扣了、余额没到账」才被发现。本服务把这类订单固化成
 * 可查询、可认领、可闭环的记录，并主动触发告警：
 *
 *   - 队列最终失败 → upsert 死信（order_no 唯一，反复失败只更新同一条）+ 告警；
 *   - 管理端按订单号查单 / 补单，处理完标记 resolved，附带处理人与备注。
 *
 * ⚠️ 本服务只做记录与触达，**不参与**落账决策，避免出现「记了死信就算处理过」。
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertService } from '../../shared/alert/alert.service';
import type { ClubPaymentCallbackSettlementParams } from './club-payments.types';
import { resolveClubOrderTypeByOrderNo } from './club-payment-callback-dispatch.service';

export interface RecordCallbackFailureParams {
  /** 业务订单号（微信 out_trade_no） */
  orderNo: string;
  /** 队列实际已尝试次数 */
  attempts: number;
  /** 失败原因摘要（不落堆栈） */
  reason: string;
  /** 回调携带的结算参数，人工补单时用于重建落账入参 */
  settlementParams: ClubPaymentCallbackSettlementParams;
}

export interface ClubCallbackFailureItem {
  id: number;
  orderNo: string;
  orderType: string;
  storeId: number | null;
  transactionId: string | null;
  amountFen: number | null;
  reason: string;
  attempts: number;
  status: string;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * 结算参数转 Prisma Json 字段。
 *
 * Prisma 的 InputJsonValue 要求索引签名，业务接口类型无法直接断言；
 * 这里经 unknown 收窄——入参结构固定且只含原始类型，风险可控。
 */
const toPayloadSnapshot = (
  params: ClubPaymentCallbackSettlementParams,
): Prisma.InputJsonValue => params as unknown as Prisma.InputJsonValue;

@Injectable()
export class ClubPaymentCallbackFailureService {
  private readonly logger = new Logger(ClubPaymentCallbackFailureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertService: AlertService,
  ) {}

  /** 记录一次「队列重试耗尽」，并触发人工介入告警 */
  async recordRetryExhausted(
    params: RecordCallbackFailureParams,
  ): Promise<void> {
    const orderType = this.resolveOrderType(params.orderNo);
    const storeId = await this.resolveStoreId(orderType, params.orderNo);

    await this.prisma.clubPaymentCallbackFailure.upsert({
      where: { orderNo: params.orderNo },
      create: {
        orderNo: params.orderNo,
        orderType,
        storeId,
        transactionId: params.settlementParams.transactionId,
        amountFen: params.settlementParams.amountFen,
        stage: 'queue_retry_exhausted',
        reason: params.reason,
        attempts: params.attempts,
        payloadSnapshot: toPayloadSnapshot(params.settlementParams),
      },
      update: {
        attempts: params.attempts,
        reason: params.reason,
        transactionId: params.settlementParams.transactionId,
        amountFen: params.settlementParams.amountFen,
        payloadSnapshot: toPayloadSnapshot(params.settlementParams),
      },
    });

    this.logger.error(
      `[支付回调死信] orderNo=${params.orderNo} orderType=${orderType} ` +
        `storeId=${storeId ?? 'unknown'} transactionId=${params.settlementParams.transactionId} ` +
        `attempts=${params.attempts} reason=${params.reason}`,
    );

    await this.alertService.send({
      level: 'error',
      title: '微信支付回调落账失败（钱已扣、余额未到账）',
      content:
        `orderNo=${params.orderNo} orderType=${orderType} storeId=${storeId ?? 'unknown'} ` +
        `金额=${params.settlementParams.amountFen} 分 重试=${params.attempts} 次 原因=${params.reason}，` +
        '请到管理端按订单号补单',
      suppressKey: `club-callback-failure:${params.orderNo}`,
    });
  }

  /** 待处理 / 全部死信列表（管理端用） */
  async list(params: {
    status?: string;
    limit?: number;
  }): Promise<ClubCallbackFailureItem[]> {
    const limit = Math.min(params.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const records = await this.prisma.clubPaymentCallbackFailure.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return records.map((record) => this.toItem(record));
  }

  /** 人工处理完一笔死信：标记 resolved / ignore，记录处理人与备注 */
  async resolve(params: {
    id: number;
    status: 'resolved' | 'ignore';
    note?: string;
    operatorId: number;
  }): Promise<ClubCallbackFailureItem> {
    const existing = await this.prisma.clubPaymentCallbackFailure.findUnique({
      where: { id: params.id },
    });

    if (!existing) {
      throw new NotFoundException('死信记录不存在');
    }

    const updated = await this.prisma.clubPaymentCallbackFailure.update({
      where: { id: params.id },
      data: {
        status: params.status,
        resolutionNote: params.note ?? null,
        resolvedAt: new Date(),
        resolvedBy: params.operatorId,
      },
    });

    this.logger.log(
      `[支付回调死信] orderNo=${updated.orderNo} 已处理 status=${params.status} 操作人=${params.operatorId}`,
    );
    return this.toItem(updated);
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  /** 订单类型从订单号前缀推导；推导不出时记为 unknown，不影响死信入库 */
  private resolveOrderType(orderNo: string): string {
    try {
      return resolveClubOrderTypeByOrderNo(orderNo);
    } catch {
      return 'unknown';
    }
  }

  /**
   * 死信上补门店 ID：门店维度排查能直接定位到「某门店收款配置有问题」。
   * 目前只为充值单回源；其余订单类型表结构不同，留 null 由人工按订单号查。
   */
  private async resolveStoreId(
    orderType: string,
    orderNo: string,
  ): Promise<number | null> {
    if (orderType !== 'recharge') {
      return null;
    }
    const order = await this.prisma.clubRechargeOrder.findUnique({
      where: { orderNo },
      select: { storeId: true },
    });
    return order?.storeId ?? null;
  }

  private toItem(record: {
    id: number;
    orderNo: string;
    orderType: string;
    storeId: number | null;
    transactionId: string | null;
    amountFen: number | null;
    reason: string;
    attempts: number;
    status: string;
    resolutionNote: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }): ClubCallbackFailureItem {
    return {
      id: record.id,
      orderNo: record.orderNo,
      orderType: record.orderType,
      storeId: record.storeId,
      transactionId: record.transactionId,
      amountFen: record.amountFen,
      reason: record.reason,
      attempts: record.attempts,
      status: record.status,
      resolutionNote: record.resolutionNote,
      createdAt: record.createdAt,
      resolvedAt: record.resolvedAt,
    };
  }
}
