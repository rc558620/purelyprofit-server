/**
 * ClubPaymentCallbackSignatureService
 *
 * 校验微信支付 v3 回调的 HTTP 请求头签名（Wechatpay-Signature）。
 *
 * 微信签名规范：
 *   签名消息串 = {timestamp}\n{nonce}\n{body}\n
 *   签名算法：RSA-SHA256（微信使用其平台公钥签名，实际验签需下载平台证书）
 *
 * 当前实现策略：
 *   - 生产环境：应下载微信平台证书，用平台公钥做 RSA 验签。
 *     证书下载：GET /v3/certificates
 *   - 当前实现：仅校验时间戳时效性（防重放）+ 必填头存在性。
 *     RSA 验签依赖平台证书，证书管理较重（需定期轮换），
 *     在首次上线阶段由 IP 白名单 + HTTPS 保障安全，后续可按需补充完整验签。
 *
 * 如需完整 RSA 验签，可在 assertWechatCallbackSignature 中调用 verifyWithPublicKey。
 */
import { createVerify, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClubWechatCallbackHeaders } from './club-payments.types';

@Injectable()
export class ClubPaymentCallbackSignatureService {
  private readonly logger = new Logger(
    ClubPaymentCallbackSignatureService.name,
  );

  constructor(private readonly configService: ConfigService) {}

  /**
   * 校验微信回调请求头签名。
   *
   * 强制校验：
   *  1. Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Signature 头必须存在
   *  2. 时间戳时效性（默认 ±300 秒，防重放）
   *
   * 可选校验（生产推荐，需配置平台公钥）：
   *  - 若 WECHAT_PLATFORM_PUBLIC_KEY_CONTENT 已配置，则进行 RSA-SHA256 验签
   */
  assertWechatCallbackSignature(
    rawBody: string,
    headers: ClubWechatCallbackHeaders,
  ): void {
    const timestamp = headers.timestamp?.trim();
    const nonce = headers.nonce?.trim();
    const signature = headers.signature?.trim();

    if (!timestamp || !nonce || !signature) {
      throw new UnauthorizedException('缺少微信支付回调签名头');
    }

    // 时间戳时效性校验
    const timestampMs = this.parseCallbackTimestampMs(timestamp);
    const ageMs = Math.abs(Date.now() - timestampMs);
    if (ageMs > this.getWechatCallbackMaxAgeSeconds() * 1000) {
      throw new UnauthorizedException('微信支付回调已过期');
    }

    // RSA-SHA256 验签（仅在平台公钥已配置时执行）
    const platformPublicKey = this.loadPlatformPublicKey();
    if (platformPublicKey) {
      this.verifyRsaSignature(
        rawBody,
        timestamp,
        nonce,
        signature,
        platformPublicKey,
      );
    } else {
      this.logger.warn(
        'WECHAT_PLATFORM_PUBLIC_KEY_CONTENT 未配置，跳过 RSA 验签（仅靠时间戳防重放）。' +
          '生产环境请配置微信平台公钥以启用完整签名校验。',
      );
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /**
   * 使用微信平台公钥做 RSA-SHA256 验签
   *
   * 签名消息串：{timestamp}\n{nonce}\n{body}\n
   */
  private verifyRsaSignature(
    rawBody: string,
    timestamp: string,
    nonce: string,
    signatureBase64: string,
    platformPublicKeyPem: string,
  ): void {
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;

    try {
      const verify = createVerify('RSA-SHA256');
      verify.update(message, 'utf8');
      const isValid = verify.verify(
        platformPublicKeyPem,
        signatureBase64,
        'base64',
      );

      if (!isValid) {
        throw new UnauthorizedException('微信支付回调签名校验失败');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('微信平台公钥 RSA 验签异常，公钥格式可能有误', error);
      throw new UnauthorizedException('微信支付回调签名校验异常');
    }
  }

  /**
   * 验证两个签名是否一致（防时序攻击）
   * 仅当两串长度相同且内容完全一致时才通过
   */
  compareSignatures(expected: string, received: string): boolean {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(received, 'utf8');

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  private parseCallbackTimestampMs(timestamp: string): number {
    const timestampMs = Number.parseInt(timestamp, 10) * 1000;
    if (!Number.isFinite(timestampMs)) {
      throw new UnauthorizedException('微信支付回调时间戳非法');
    }
    return timestampMs;
  }

  private getWechatCallbackMaxAgeSeconds(): number {
    return (
      this.configService.get<number>('club.wechatCallbackMaxAgeSeconds') ?? 300
    );
  }

  /**
   * 加载微信平台公钥 PEM（用于验签回调签名）
   * 配置项：WECHAT_PLATFORM_PUBLIC_KEY_CONTENT（PEM 内联，支持 \n 转义）
   */
  private loadPlatformPublicKey(): string | null {
    const content = this.configService
      .get<string>('wechat.platformPublicKeyContent')
      ?.trim();

    if (!content) {
      return null;
    }

    return content.replace(/\\n/g, '\n');
  }
}
