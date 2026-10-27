/**
 * ClubWechatJsapiService
 *
 * 封装微信支付 JSAPI 下单（v3）接口调用：
 *  POST https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi
 *
 * 认证方式：WECHATPAY2-SHA256-RSA2048（商户私钥签名）
 * 返回值：前端调起微信支付所需的 ClubWechatPaymentParamsDto
 *
 * 依赖：
 *   - StoresWechatPayService      读取门店的 mchId / apiV3Key / 证书序列号
 *   - ConfigService               读取 WECHAT_APP_ID / WECHAT_PAY_NOTIFY_URL
 *   - ClubWechatPayHttpService    私钥加载、鉴权头、请求超时与错误解析（与查单 / 关单共用）
 *
 * 门店未配置收款时抛出带 `STORE_PAY_CONFIG_MISSING` 业务码的异常，
 * 前端据此提示「该门店暂不支持在线充值」，而不是笼统的「支付失败」。
 */
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import {
  STORE_PAY_CONFIG_MISSING_CODE,
  STORE_PAY_CONFIG_MISSING_MESSAGE,
} from './club-wechat-pay.errors';

/** JSAPI 下单路径 */
const WECHAT_JSAPI_ORDER_PATH = '/v3/pay/transactions/jsapi';

export interface WechatJsapiOrderRequest {
  storeId: number;
  orderNo: string;
  description: string;
  amountFen: number;
  openid: string;
}

interface WechatJsapiPrePayResponse {
  prepay_id?: string;
}

@Injectable()
export class ClubWechatJsapiService {
  private readonly logger = new Logger(ClubWechatJsapiService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storesWechatPayService: StoresWechatPayService,
    private readonly wechatPayHttpService: ClubWechatPayHttpService,
  ) {}

  /**
   * 校验门店已配置微信收款。
   *
   * 下单前显式调用：门店没配收款时不要等微信返回错误再翻译，
   * 那样前端只能拿到通用「支付失败」，用户不知道是门店侧问题。
   */
  async assertStorePayConfigured(storeId: number): Promise<void> {
    const config =
      await this.storesWechatPayService.getWechatPayConfigForStore(storeId);

    if (!config.mchId || !config.apiV3Key) {
      this.logger.warn(`门店 ${storeId} 未配置微信收款，拒绝创建在线支付订单`);
      throw new BadRequestException({
        code: STORE_PAY_CONFIG_MISSING_CODE,
        message: STORE_PAY_CONFIG_MISSING_MESSAGE,
      });
    }
  }

  /**
   * 向微信统一下单 v3 接口请求 prepay_id，并组装前端拉起支付所需的签名参数。
   */
  async createJsapiPaymentParams(
    params: WechatJsapiOrderRequest,
  ): Promise<ClubWechatPaymentParamsDto> {
    const config = await this.storesWechatPayService.getWechatPayConfigForStore(
      params.storeId,
    );

    if (!config.mchId || !config.apiV3Key) {
      throw new BadRequestException({
        code: STORE_PAY_CONFIG_MISSING_CODE,
        message: STORE_PAY_CONFIG_MISSING_MESSAGE,
      });
    }

    const appId = this.wechatPayHttpService.getRequiredConfig('wechat.appId');
    const notifyUrl = this.wechatPayHttpService.getRequiredConfig(
      'wechat.payNotifyUrl',
    );
    const privateKeyPem = await this.wechatPayHttpService.loadPrivateKeyPem();

    const prepayId = await this.requestPrepayId({
      mchId: config.mchId,
      notifyUrl,
      privateKeyPem,
      orderNo: params.orderNo,
      storeId: params.storeId,
      description: params.description,
      amountFen: params.amountFen,
      openid: params.openid,
    });

    return this.buildJsapiPaymentParams(appId, prepayId, privateKeyPem);
  }

  // ─── 统一下单请求 ─────────────────────────────────────────────────────────

  private async requestPrepayId(opts: {
    mchId: string;
    notifyUrl: string;
    privateKeyPem: string | null;
    orderNo: string;
    storeId: number;
    description: string;
    amountFen: number;
    openid: string;
  }): Promise<string> {
    const appId = this.wechatPayHttpService.getRequiredConfig('wechat.appId');
    const body = JSON.stringify({
      appid: appId,
      mchid: opts.mchId,
      description: opts.description,
      out_trade_no: opts.orderNo,
      notify_url: opts.notifyUrl,
      amount: { total: opts.amountFen, currency: 'CNY' },
      payer: { openid: opts.openid },
    });

    const result =
      await this.wechatPayHttpService.request<WechatJsapiPrePayResponse>({
        method: 'POST',
        urlPath: WECHAT_JSAPI_ORDER_PATH,
        mchId: opts.mchId,
        body,
      });

    if (result.ok) {
      const prepayId = result.data?.prepay_id;
      if (!prepayId) {
        throw new InternalServerErrorException(
          '微信支付返回数据异常，prepay_id 为空',
        );
      }
      return prepayId;
    }

    // 结构化日志：门店维度定位配置问题必须能看到商户号与微信错误码
    this.logger.error(
      `微信下单失败 orderNo=${opts.orderNo} storeId=${opts.storeId} ` +
        `mchId=${opts.mchId} httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'} message=${result.message}`,
    );
    throw new InternalServerErrorException(
      `微信支付下单失败：${result.message || '请联系客服'}`,
    );
  }

  // ─── 前端支付参数组装 ──────────────────────────────────────────────────────

  /**
   * 根据 prepay_id 组装前端 wx.requestPayment 所需的签名参数
   *
   * 签名消息格式（微信官方规范，4 行 + 末尾换行）：
   *   {appId}\n{timestamp}\n{nonceStr}\n{package}\n
   *
   * 算法：RSA-SHA256，输出 Base64
   */
  private buildJsapiPaymentParams(
    appId: string,
    prepayId: string,
    privateKeyPem: string | null,
  ): ClubWechatPaymentParamsDto {
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(16).toString('hex');
    const packageStr = `prepay_id=${prepayId}`;

    const signMessage = `${appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
    const paySign = this.wechatPayHttpService.signWithRsa(
      signMessage,
      privateKeyPem,
    );

    return {
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: 'RSA',
      paySign,
    };
  }
}
