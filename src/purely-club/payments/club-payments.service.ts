import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubOrdersService } from '../orders/club-orders.service';
import { ClubRechargeService } from '../recharge/club-recharge.service';
import type {
  ClubWechatPaymentCallbackAckDto,
  ClubWechatPaymentCallbackDto,
} from './dto/club-wechat-callback.dto';

interface WechatCallbackHeaders {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
}

@Injectable()
export class ClubPaymentsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly clubRechargeService: ClubRechargeService,
    private readonly clubOrdersService: ClubOrdersService,
  ) {}

  async handleWechatCallback(
    payload: ClubWechatPaymentCallbackDto,
    headers: WechatCallbackHeaders,
  ): Promise<ClubWechatPaymentCallbackAckDto> {
    this.assertSignatureValid(payload, headers);

    const callbackReceivedAtMs = Date.now();
    const paidAtMs = this.resolvePaidAtMs(payload.paidAt, callbackReceivedAtMs);

    if (payload.orderType === 'recharge') {
      const order = await this.clubRechargeService.confirmOrderPaidByCallback(
        payload.orderNo,
        {
          amountFen: payload.amountFen,
          transactionId: payload.transactionId,
          paidAtMs,
          callbackReceivedAtMs,
        },
      );

      return {
        success: true,
        orderNo: order.orderNo,
        orderType: order.orderType,
        status: order.status,
      };
    }

    const order = await this.clubOrdersService.confirmOrderPaidByCallback(
      payload.orderNo,
      {
        amountFen: payload.amountFen,
        transactionId: payload.transactionId,
        paidAtMs,
        callbackReceivedAtMs,
      },
    );

    return {
      success: true,
      orderNo: order.orderNo,
      orderType: order.orderType,
      status: order.status,
    };
  }

  private assertSignatureValid(
    payload: ClubWechatPaymentCallbackDto,
    headers: WechatCallbackHeaders,
  ): void {
    const timestamp = headers.timestamp?.trim();
    const nonce = headers.nonce?.trim();
    const signature = headers.signature?.trim();

    if (!timestamp || !nonce || !signature) {
      throw new UnauthorizedException('缺少微信支付回调签名头');
    }

    const timestampMs = Number.parseInt(timestamp, 10) * 1000;
    if (!Number.isFinite(timestampMs)) {
      throw new UnauthorizedException('微信支付回调时间戳非法');
    }

    const maxAgeSeconds =
      this.configService.get<number>('club.wechatCallbackMaxAgeSeconds') ?? 300;
    const ageMs = Math.abs(Date.now() - timestampMs);
    if (ageMs > maxAgeSeconds * 1000) {
      throw new UnauthorizedException('微信支付回调已过期');
    }

    const secret =
      this.configService.get<string>('club.wechatCallbackSecret') ?? '';
    if (!secret.trim()) {
      throw new UnauthorizedException('未配置微信支付回调签名密钥');
    }

    const expectedSignature = this.buildSignature({
      timestamp,
      nonce,
      payload,
      secret,
    });

    const received = Buffer.from(signature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    const signatureMatches =
      received.length === expected.length &&
      timingSafeEqual(received, expected);

    if (!signatureMatches) {
      throw new UnauthorizedException('微信支付回调签名校验失败');
    }
  }

  private resolvePaidAtMs(
    paidAt: string | undefined,
    fallbackMs: number,
  ): number {
    if (!paidAt) {
      return fallbackMs;
    }

    const parsed = Date.parse(paidAt);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('paidAt 不是合法时间');
    }

    return parsed;
  }

  private buildSignature(params: {
    timestamp: string;
    nonce: string;
    payload: ClubWechatPaymentCallbackDto;
    secret: string;
  }): string {
    const message = `${params.timestamp}\n${params.nonce}\n${this.stableStringify(
      params.payload,
    )}\n`;

    return createHmac('sha256', params.secret)
      .update(message)
      .digest('hex')
      .toUpperCase();
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));

      return `{${entries
        .map(
          ([key, entryValue]) =>
            `${JSON.stringify(key)}:${this.stableStringify(entryValue)}`,
        )
        .join(',')}}`;
    }

    return JSON.stringify(value);
  }
}
