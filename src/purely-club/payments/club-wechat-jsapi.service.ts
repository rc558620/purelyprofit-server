/**
 * ClubWechatJsapiService
 *
 * 封装微信支付 JSAPI 下单（v3）接口调用：
 *   - 直连模式：  POST /v3/pay/transactions/jsapi
 *   - 服务商模式：POST /v3/pay/partner/transactions/jsapi
 *
 * 认证方式：WECHATPAY2-SHA256-RSA2048（商户私钥签名）
 * 返回值：前端调起微信支付所需的 ClubWechatPaymentParamsDto
 *
 * 依赖：
 *   - ClubWechatPayIdentityService  解析本次收款身份（签名商户号 / 子商户号 / AppID / 回调地址）
 *   - StoresWechatPayService        读取门店收款配置（子商户号的唯一来源）
 *   - ClubWechatPayHttpService      私钥加载、鉴权头、请求超时与错误解析（与查单 / 关单 / 退款共用）
 *
 * ⚠️ 凭据口径（务必看清，历史上这里写错过）：**证书序列号与私钥一律取全局/服务商配置，
 * 不是门店配置**；门店只提供「收款商户号（服务商模式下为子商户号）」。服务商模式下
 * 签名主体是服务商商户号（sp_mchid），真实收款方由 sub_mchid 指定。
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
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import type { ClubWechatPayTarget } from './club-wechat-pay-identity.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import {
  STORE_PAY_CONFIG_MISSING_CODE,
  STORE_PAY_CONFIG_MISSING_MESSAGE,
} from './club-wechat-pay.errors';

/** JSAPI 下单路径：直连模式 */
const STORE_JSAPI_ORDER_PATH = '/v3/pay/transactions/jsapi';
/** JSAPI 下单路径：服务商模式 */
const PARTNER_JSAPI_ORDER_PATH = '/v3/pay/partner/transactions/jsapi';

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
    private readonly storesWechatPayService: StoresWechatPayService,
    private readonly wechatPayHttpService: ClubWechatPayHttpService,
    private readonly identityService: ClubWechatPayIdentityService,
  ) {}

  /**
   * 校验门店已配置微信收款。
   *
   * 下单前显式调用：门店没配收款时不要等微信返回错误再翻译，
   * 那样前端只能拿到通用「支付失败」，用户不知道是门店侧问题。
   *
   * 服务商模式下**不要求** APIv3 密钥：子商户在微信侧不存在也不支持设置它
   * （回调统一由服务商密钥加密）。直连模式下仍必须提供，否则回调解不开。
   */
  async assertStorePayConfigured(storeId: number): Promise<void> {
    await this.resolveTargetOrThrow(storeId);
  }

  /**
   * 向微信统一下单 v3 接口请求 prepay_id，并组装前端拉起支付所需的签名参数。
   */
  async createJsapiPaymentParams(
    params: WechatJsapiOrderRequest,
  ): Promise<ClubWechatPaymentParamsDto> {
    const target = await this.resolveTargetOrThrow(params.storeId);
    const privateKeyPem = await this.wechatPayHttpService.loadPrivateKeyPem(
      target.mode,
    );

    const prepayId = await this.requestPrepayId({
      target,
      orderNo: params.orderNo,
      storeId: params.storeId,
      description: params.description,
      amountFen: params.amountFen,
      openid: params.openid,
    });

    return this.buildJsapiPaymentParams(target.appId, prepayId, privateKeyPem);
  }

  // ─── 统一下单请求 ─────────────────────────────────────────────────────────

  /**
   * 解析门店收款身份，缺失时抛统一的业务异常。
   *
   * 这里是「门店能不能收这笔钱」的唯一判定入口，四个调用点（下单 / 查单 / 关单 / 退款）
   * 都不允许自己拼判断条件，否则灰度期口径会漂移。
   */
  private async resolveTargetOrThrow(
    storeId: number,
  ): Promise<ClubWechatPayTarget> {
    const target = await this.identityService.resolveTarget(storeId);
    if (!target) {
      this.logger.warn(`门店 ${storeId} 未配置微信收款，拒绝创建在线支付订单`);
      throw new BadRequestException({
        code: STORE_PAY_CONFIG_MISSING_CODE,
        message: STORE_PAY_CONFIG_MISSING_MESSAGE,
      });
    }

    // 直连模式的回调由门店自己的密钥加密，缺密钥等于「能付但收不到通知」
    if (target.mode === 'store') {
      const config =
        await this.storesWechatPayService.getWechatPayConfigForStore(storeId);
      if (!config.apiV3Key) {
        this.logger.warn(
          `门店 ${storeId} 处于直连模式但未配置 APIv3 密钥，拒绝下单（回调将无法解密）`,
        );
        throw new BadRequestException({
          code: STORE_PAY_CONFIG_MISSING_CODE,
          message: STORE_PAY_CONFIG_MISSING_MESSAGE,
        });
      }
    }

    return target;
  }

  private async requestPrepayId(opts: {
    target: ClubWechatPayTarget;
    orderNo: string;
    storeId: number;
    description: string;
    amountFen: number;
    openid: string;
  }): Promise<string> {
    const urlPath =
      opts.target.mode === 'partner'
        ? PARTNER_JSAPI_ORDER_PATH
        : STORE_JSAPI_ORDER_PATH;
    const body = this.buildOrderBody(opts);

    const result =
      await this.wechatPayHttpService.request<WechatJsapiPrePayResponse>({
        method: 'POST',
        urlPath,
        mchId: opts.target.signMchId,
        credential: opts.target.mode,
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

    // 结构化日志：门店维度定位配置问题必须能看到「签名主体 + 真实收款商户号」与微信错误码
    this.logger.error(
      `微信下单失败 orderNo=${opts.orderNo} storeId=${opts.storeId} mode=${opts.target.mode} ` +
        `signMchId=${opts.target.signMchId} settleMchId=${opts.target.settleMchId} ` +
        `httpStatus=${result.status} wechatCode=${result.code ?? 'UNKNOWN'} message=${result.message}`,
    );
    throw new InternalServerErrorException(
      `微信支付下单失败：${result.message || '请联系客服'}`,
    );
  }

  /**
   * 组装下单请求体。
   *
   * 服务商模式下字段名全部变化：appid/mchid → sp_appid/sp_mchid + sub_mchid，
   * 付款人 openid → sp_openid（本平台统一以 purelyClub AppID 作 sp_appid 的必然结果）。
   */
  private buildOrderBody(opts: {
    target: ClubWechatPayTarget;
    orderNo: string;
    description: string;
    amountFen: number;
    openid: string;
  }): string {
    const common = {
      description: opts.description,
      out_trade_no: opts.orderNo,
      notify_url: opts.target.notifyUrl,
      amount: { total: opts.amountFen, currency: 'CNY' },
    };

    if (opts.target.mode === 'partner') {
      return JSON.stringify({
        ...common,
        sp_appid: opts.target.appId,
        sp_mchid: opts.target.signMchId,
        sub_mchid: opts.target.settleMchId,
        payer: { sp_openid: opts.openid },
      });
    }

    return JSON.stringify({
      ...common,
      appid: opts.target.appId,
      mchid: opts.target.settleMchId,
      payer: { openid: opts.openid },
    });
  }

  // ─── 前端支付参数组装 ──────────────────────────────────────────────────────

  /**
   * 根据 prepay_id 组装前端 wx.requestPayment 所需的签名参数
   *
   * 签名消息格式（微信官方规范，4 行 + 末尾换行）：
   *   {appId}\n{timestamp}\n{nonceStr}\n{package}\n
   *
   * 算法：RSA-SHA256，输出 Base64
   *
   * ⚠️ appId 必须与**下单时实际使用的那个**完全一致：服务商模式下是 sp_appid，
   * 前端拿到的调起参数与下单主体不一致时，小程序能拉起但会被微信直接拒绝。
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
