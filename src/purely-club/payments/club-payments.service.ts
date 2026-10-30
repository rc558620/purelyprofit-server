import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import type {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
  WechatDecryptedTransaction,
} from './dto/club-wechat-callback.dto';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { ClubPaymentCallbackJobData } from '../../queue/club-payment-callback.types';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
  ClubWechatCallbackHeaders,
} from './club-payments.types';

@Injectable()
export class ClubPaymentsService {
  private readonly logger = new Logger(ClubPaymentsService.name);

  constructor(
    private readonly clubPaymentCallbackSignatureService: ClubPaymentCallbackSignatureService,
    private readonly clubPaymentCallbackDispatchService: ClubPaymentCallbackDispatchService,
    private readonly clubWechatCallbackDecryptorService: ClubWechatCallbackDecryptorService,
    private readonly identityService: ClubWechatPayIdentityService,
    private readonly paymentOrderRecordService: ClubPaymentOrderRecordService,
    /** 服务购买单（SV）无订单表，门店 ID 只能从草稿里取 */
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    @InjectQueue('club-payment-callback')
    private readonly paymentCallbackQueue: Queue<ClubPaymentCallbackJobData>,
  ) {}

  /**
   * 处理微信支付回调（v3 真实格式）
   *
   * 处理流程：
   *  1. 校验签名头（时间戳时效 + 可选 RSA 验签）
   *  2. 仅处理 TRANSACTION.SUCCESS 事件
   *  3. AES-256-GCM 解密 resource.ciphertext，得到交易详情
   *  4. 校验交易状态、提取 orderNo / transactionId / amountFen
   *  5. 按订单号路由到充值或服务购买的落账逻辑
   */
  async handleWechatCallback(
    payload: ClubWechatPaymentCallbackDto,
    headers: ClubWechatCallbackHeaders,
    rawBody: string,
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    // 1. 签名校验
    // 显式声明 scope='club'：服务商模式开启后本链路改用服务商维度的平台证书验签，
    // 短信充值与平台会员/额度两条链路不传该参数，默认仍取全局平台证书（行为不变）。
    this.clubPaymentCallbackSignatureService.assertWechatCallbackSignature(
      rawBody,
      headers,
      'club',
    );

    // 2. 仅处理支付成功事件。
    // 按微信回调协议必须回 200：返回 4xx/5xx 会被判定为通知失败并持续重投，
    // 而这类事件（REFUND.CLOSED 等）重投多少次也不会变成可处理事件。
    if (payload.event_type !== 'TRANSACTION.SUCCESS') {
      this.logger.log(`忽略非支付成功回调事件: ${payload.event_type}`);
      return {
        success: true,
        orderNo: '',
        orderType: 'unknown',
        status: 'ignored',
      };
    }

    // 3. 解密密文
    const decryptedTx =
      await this.clubWechatCallbackDecryptorService.decryptCallback(payload);

    // 4. 校验并提取字段
    const { orderNo, transactionId, amountFen, paidAt } =
      this.clubWechatCallbackDecryptorService.validateAndExtract(decryptedTx);

    this.logger.log(
      `微信支付回调解密成功: orderNo=${orderNo}, transactionId=${transactionId}, amountFen=${amountFen}`,
    );

    // 4.1 资金归属校验：回调里的收款主体必须与平台配置一致，并把权威商户号落到订单上
    await this.assertMerchantMatchesAndPersist(decryptedTx, orderNo);

    // 5. 路由落账
    const callbackReceivedAtMs = Date.now();
    const settlementParams = this.buildSettlementParams({
      amountFen,
      transactionId,
      paidAt,
      callbackReceivedAtMs,
    });

    await this.paymentCallbackQueue.add(
      `wechat-payment:${orderNo}`,
      { orderNo, settlementParams },
      {
        jobId: `wechat-payment:${orderNo}:${transactionId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: { age: 604_800, count: 10_000 },
      },
    );

    return {
      success: true,
      orderNo,
      orderType: 'scan_ordering',
      status: 'pending',
    };
  }

  /**
   * 校验回调报文里的收款主体，并把权威商户号写回订单。
   *
   * 两道闸门，任一不通过都**拒绝入账**（微信会重投，但绝不能把钱记到错的主体上）：
   *  1. 服务商模式下 sp_mchid 必须等于平台配置的服务商商户号；
   *  2. sub_mchid（真实收款方）必须等于该门店当前配置的收款商户号 ——
   *     这一条同时挡住「商家换绑子商户后，微信仍按旧主体回调」的资金错配。
   *
   * 落库顺序：先读订单记录拿到门店，再按配置比对，最后写入。写入幂等（重复回调同值）。
   */
  private async assertMerchantMatchesAndPersist(
    tx: WechatDecryptedTransaction,
    orderNo: string,
  ): Promise<void> {
    const callbackIdentity =
      this.clubWechatCallbackDecryptorService.extractMerchantIdentity(tx);
    const record = await this.paymentOrderRecordService.findByOrderNo(orderNo);

    if (this.identityService.isPartnerMode()) {
      const expectedSpMchId = this.identityService.getPartnerSpMchId();
      if (
        callbackIdentity.signMchId &&
        expectedSpMchId &&
        callbackIdentity.signMchId !== expectedSpMchId
      ) {
        this.logger.error(
          `回调资金归属异常 orderNo=${orderNo} 回调 sp_mchid=${callbackIdentity.signMchId} ` +
            `平台配置=${expectedSpMchId}，已拒绝入账`,
        );
        throw new UnauthorizedException(
          '微信支付回调的收款主体与平台配置不一致',
        );
      }
    }

    // 门店来源有两条：订单落库记录（RC/VC/SO/SF），或服务购买单的 Redis 草稿（SV 无落库表）
    const storeId =
      record?.storeId ?? (await this.resolveStoreIdFromServiceDraft(orderNo));

    if (storeId == null) {
      this.logger.warn(
        `订单 ${orderNo} 既无支付记录也无服务购买单草稿，跳过收款商户号比对与落库` +
          '（该订单类型尚未接入，需确认是否允许在线收款）',
      );
      return;
    }

    const expected = await this.identityService.resolveTarget(storeId);
    if (
      expected &&
      callbackIdentity.settleMchId &&
      callbackIdentity.settleMchId !== expected.settleMchId
    ) {
      this.logger.error(
        `回调资金归属异常 orderNo=${orderNo} storeId=${storeId} ` +
          `回调 sub_mchid=${callbackIdentity.settleMchId} 配置=${expected.settleMchId}，已拒绝入账`,
      );
      throw new UnauthorizedException(
        '微信支付回调的收款商户号与门店配置不一致',
      );
    }

    if (!record) {
      // SV 服务购买单只存在草稿，没有可落库的订单表：校验已做，但商户号存不下
      this.logger.warn(
        `订单 ${orderNo} 为服务购买单（仅有草稿、无落库表）：资金归属校验已通过，` +
          '但商户号无法落库，将来若发生退款会回落到门店当前配置，需人工核对',
      );
      return;
    }

    await this.paymentOrderRecordService.persistMerchantIdentity(
      orderNo,
      callbackIdentity.signMchId,
      callbackIdentity.settleMchId,
    );
  }

  /**
   * 服务购买单（SV）没有订单表，门店 ID 只能从 Redis 草稿里取。
   *
   * 取不到时返回 null（并留下日志），由调用方决定「跳过校验」——
   * 草稿过期/不存在在 SV 场景下是常态，不能因此把正常回调判成异常。
   */
  private async resolveStoreIdFromServiceDraft(
    orderNo: string,
  ): Promise<number | null> {
    try {
      const draft = await this.clubOrderDraftsService.getDraftByOrderId(
        orderNo,
        'service',
      );
      return draft?.storeId ?? null;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `订单 ${orderNo} 未找到服务购买单草稿（${reason}），无法取得门店 ID`,
      );
      return null;
    }
  }

  private buildSettlementParams(opts: {
    amountFen: number;
    transactionId: string;
    paidAt: string | undefined;
    callbackReceivedAtMs: number;
  }): ClubPaymentCallbackSettlementParams {
    const paidAtMs = opts.paidAt
      ? this.parsePaidAtMs(opts.paidAt, opts.callbackReceivedAtMs)
      : opts.callbackReceivedAtMs;

    return {
      amountFen: opts.amountFen,
      transactionId: opts.transactionId,
      paidAtMs,
      callbackReceivedAtMs: opts.callbackReceivedAtMs,
    };
  }

  private parsePaidAtMs(paidAt: string, fallbackMs: number): number {
    const parsed = Date.parse(paidAt);
    if (Number.isNaN(parsed)) {
      this.logger.warn(
        `微信回调 success_time 无法解析: ${paidAt}，使用当前时间`,
      );
      return fallbackMs;
    }
    return parsed;
  }

  private toCallbackAck(
    order: ClubPaymentCallbackResult,
  ): ClubWechatPaymentCallbackAckDto {
    return {
      success: true,
      orderNo: order.orderNo,
      orderType: order.orderType,
      status: order.status,
    };
  }
}
