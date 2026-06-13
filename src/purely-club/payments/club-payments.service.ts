import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ClubPaymentCallbackDispatchService } from './club-payment-callback-dispatch.service';
import { ClubPaymentCallbackSignatureService } from './club-payment-callback-signature.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import type {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';
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
    this.clubPaymentCallbackSignatureService.assertWechatCallbackSignature(
      rawBody,
      headers,
    );

    // 2. 仅处理支付成功事件，其他事件返回 200 但不落账
    if (payload.event_type !== 'TRANSACTION.SUCCESS') {
      this.logger.log(`忽略非支付成功回调事件: ${payload.event_type}`);
      throw new BadRequestException(
        `不支持的回调事件类型: ${payload.event_type}，仅处理 TRANSACTION.SUCCESS`,
      );
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

    // 5. 路由落账
    const callbackReceivedAtMs = Date.now();
    const settlementParams = this.buildSettlementParams({
      amountFen,
      transactionId,
      paidAt,
      callbackReceivedAtMs,
    });

    const order =
      await this.clubPaymentCallbackDispatchService.dispatchByOrderNo(
        orderNo,
        settlementParams,
      );

    return this.toCallbackAck(order);
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
