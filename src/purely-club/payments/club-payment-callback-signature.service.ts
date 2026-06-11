import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClubWechatPaymentCallbackDto } from './dto/club-wechat-callback.dto';
import type { ClubWechatCallbackHeaders } from './club-payments.types';

@Injectable()
export class ClubPaymentCallbackSignatureService {
  constructor(private readonly configService: ConfigService) {}

  assertWechatCallbackSignature(
    payload: ClubWechatPaymentCallbackDto,
    headers: ClubWechatCallbackHeaders,
  ): void {
    const timestamp = headers.timestamp?.trim();
    const nonce = headers.nonce?.trim();
    const signature = headers.signature?.trim();

    if (!timestamp || !nonce || !signature) {
      throw new UnauthorizedException('缺少微信支付回调签名头');
    }

    const timestampMs = this.parseCallbackTimestampMs(timestamp);
    const ageMs = Math.abs(Date.now() - timestampMs);
    if (ageMs > this.getWechatCallbackMaxAgeSeconds() * 1000) {
      throw new UnauthorizedException('微信支付回调已过期');
    }

    const expectedSignature = this.buildWechatSignature({
      timestamp,
      nonce,
      payload,
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

  buildWechatSignature(params: {
    timestamp: string;
    nonce: string;
    payload: ClubWechatPaymentCallbackDto;
  }): string {
    const message = `${params.timestamp}\n${params.nonce}\n${this.stableStringify(
      params.payload,
    )}\n`;

    return createHmac('sha256', this.getWechatCallbackSecret())
      .update(message)
      .digest('hex')
      .toUpperCase();
  }

  private parseCallbackTimestampMs(timestamp: string): number {
    const timestampMs = Number.parseInt(timestamp, 10) * 1000;
    if (!Number.isFinite(timestampMs)) {
      throw new UnauthorizedException('微信支付回调时间戳非法');
    }

    return timestampMs;
  }

  private getWechatCallbackMaxAgeSeconds(): number {
    return this.configService.get<number>('club.wechatCallbackMaxAgeSeconds') ?? 300;
  }

  private getWechatCallbackSecret(): string {
    const secret = this.configService.get<string>('club.wechatCallbackSecret') ?? '';
    if (!secret.trim()) {
      throw new UnauthorizedException('未配置微信支付回调签名密钥');
    }

    return secret;
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
