// 微信支付退款服务：调用微信 v3 退款接口（POST /v3/refund/domestic/refunds），认证方式与 JSAPI 下单一致
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';

/** 微信退款请求入参 */
export interface WechatRefundRequest {
  storeId: number;
  /** 原支付订单号（out_trade_no） */
  orderNo: string;
  /** 商户退款单号（out_refund_no，幂等键） */
  refundNo: string;
  /** 原支付金额（分） */
  totalFen: number;
  /** 退款金额（分） */
  refundFen: number;
  /** 退款原因 */
  reason?: string;
}

/** 微信退款响应（成功态） */
interface WechatRefundResponse {
  status?: string;
  refund_id?: string;
  message?: string;
  code?: string;
}

/** 私钥缓存有效期（与 JSAPI 下单服务一致） */
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class ClubWechatRefundService {
  private readonly logger = new Logger(ClubWechatRefundService.name);

  /** 已加载私钥缓存 */
  private cachedPrivateKeyPem: string | null | undefined = undefined;
  private cachedPrivateKeyPemLoadedAt = 0;

  /** 运行环境：生产环境禁用任何「未真实退款却标记成功」的降级路径 */
  private readonly nodeEnv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storesWechatPayService: StoresWechatPayService,
  ) {
    this.nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
  }

  /**
   * 发起微信退款（v3 真实接口）。
   *
   * 配置不完整时 fail-closed：生产环境直接抛错（绝不能标记已退款），
   * 非生产环境保留本地联调降级通道以便跑通退款流程。
   */
  async requestRefund(
    params: WechatRefundRequest,
  ): Promise<{ refundId: string }> {
    const config = await this.storesWechatPayService.getWechatPayConfigForStore(
      params.storeId,
    );
    const serialNo = this.configService
      .get<string>('wechat.mchSerialNo')
      ?.trim();
    const privateKeyPem = await this.loadPrivateKeyPem();

    // 资金安全闸门：配置不完整时**绝不能**标记退款成功。
    // 早期实现的「DEV_REFUND_ 降级」会让系统显示已退款而钱根本没退，
    // 且门店收款配置是数据库按门店维护的，启动校验拦不住 —— 只能在调用点 fail-closed。
    if (!config.mchId || !config.apiV3Key || !serialNo || !privateKeyPem) {
      const detail =
        `mchId=${Boolean(config.mchId)}, apiV3Key=${Boolean(config.apiV3Key)}, ` +
        `serialNo=${Boolean(serialNo)}, privateKey=${Boolean(privateKeyPem)}`;
      this.logger.error(
        `微信退款配置不完整（${detail}），退款单 ${params.refundNo} 未真实发起退款`,
      );
      // 非生产保留本地联调通道（退款流程要能跑通），生产一律真实失败并告警
      if (this.nodeEnv === 'production') {
        throw new InternalServerErrorException(
          '微信退款配置不完整，退款未发起，请联系客服处理',
        );
      }
      this.logger.warn(
        `非生产环境降级：退款单 ${params.refundNo} 未真实调用微信退款接口`,
      );
      return { refundId: `DEV_REFUND_${params.refundNo}` };
    }

    const url = 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds';
    const body = JSON.stringify({
      out_trade_no: params.orderNo,
      out_refund_no: params.refundNo,
      reason: params.reason ?? '用户主动退款',
      amount: {
        refund: params.refundFen,
        total: params.totalFen,
        currency: 'CNY',
      },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const authorization = this.buildAuthorization({
      mchId: config.mchId,
      serialNo,
      privateKeyPem,
      method: 'POST',
      url,
      timestamp,
      nonce,
      body,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'User-Agent': 'purelyprofit-server/1.0',
        },
        body,
      });
      const responseJson = (await response.json()) as WechatRefundResponse;

      if (!response.ok) {
        this.logger.error(
          `微信退款失败: ${responseJson.code ?? 'UNKNOWN'} - ${responseJson.message ?? ''}`,
        );
        throw new InternalServerErrorException(
          `微信退款失败：${responseJson.message ?? '请联系客服'}`,
        );
      }
      if (!responseJson.refund_id) {
        throw new InternalServerErrorException('微信退款返回数据异常');
      }
      return { refundId: responseJson.refund_id };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error('微信退款网络请求异常', error);
      throw new InternalServerErrorException(
        '微信退款服务暂时不可用，请稍后重试',
      );
    }
  }

  /** 构造微信 v3 Authorization 头（WECHATPAY2-SHA256-RSA2048） */
  private buildAuthorization(opts: {
    mchId: string;
    serialNo: string;
    privateKeyPem: string;
    method: string;
    url: string;
    timestamp: string;
    nonce: string;
    body: string;
  }): string {
    const urlObj = new URL(opts.url);
    const canonicalUrl = urlObj.pathname + (urlObj.search || '');
    const signMessage = [
      opts.method,
      canonicalUrl,
      opts.timestamp,
      opts.nonce,
      opts.body,
      '',
    ].join('\n');

    const privateKey = createPrivateKey(opts.privateKeyPem);
    const sign = createSign('RSA-SHA256');
    sign.update(signMessage, 'utf8');
    const signature = sign.sign(privateKey, 'base64');

    return [
      `WECHATPAY2-SHA256-RSA2048 mchid="${opts.mchId}"`,
      `nonce_str="${opts.nonce}"`,
      `signature="${signature}"`,
      `timestamp="${opts.timestamp}"`,
      `serial_no="${opts.serialNo}"`,
    ].join(',');
  }

  /** 加载商户 RSA 私钥 PEM：文件路径 > 内联内容 > null（开发态） */
  private async loadPrivateKeyPem(): Promise<string | null> {
    if (
      this.cachedPrivateKeyPem !== undefined &&
      Date.now() - this.cachedPrivateKeyPemLoadedAt < PRIVATE_KEY_CACHE_TTL_MS
    ) {
      return this.cachedPrivateKeyPem;
    }
    this.cachedPrivateKeyPem = undefined;
    this.cachedPrivateKeyPemLoadedAt = Date.now();

    const keyPath = this.configService
      .get<string>('wechat.privateKeyPath')
      ?.trim();
    if (keyPath) {
      try {
        const pem = await readFile(keyPath, 'utf8');
        this.cachedPrivateKeyPem = pem;
        return pem;
      } catch (error) {
        this.logger.error(`读取微信私钥文件失败: ${keyPath}`, error);
        throw new InternalServerErrorException(
          '读取微信支付私钥文件失败，请检查 WECHAT_PRIVATE_KEY_PATH 配置',
        );
      }
    }

    const keyContent = this.configService
      .get<string>('wechat.privateKeyContent')
      ?.trim();
    if (keyContent) {
      const pem = keyContent.replace(/\\n/g, '\n');
      this.cachedPrivateKeyPem = pem;
      return pem;
    }

    this.cachedPrivateKeyPem = null;
    return null;
  }
}
