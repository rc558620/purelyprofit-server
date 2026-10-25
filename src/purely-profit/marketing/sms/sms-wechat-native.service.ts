/**
 * 短信钱包充值专用的微信 Native 下单入口。
 *
 * 实现已上浮为 `PlatformWechatNativeService`（平台级收款能力，多链路共用），
 * 本类只保留**短信链路自己的那一份差异**：专属回调地址 `SMS_WECHAT_PAY_NOTIFY_URL`。
 * 对外签名与错误语义保持不变，调用方（SmsRechargeService）无需改动。
 */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PlatformWechatNativeService,
  type WechatCloseOrderResult,
} from '../../payments/platform-wechat-native.service';

/** 日志定位用的业务链路标记：下单实现上浮后靠它区分短信链路 */
const BIZ_TYPE = 'sms_recharge';

export interface CreateSmsNativeOrderParams {
  orderNo: string;
  amountFen: number;
  description: string;
}

@Injectable()
export class SmsWechatNativeService {
  constructor(
    private readonly configService: ConfigService,
    private readonly platformNativeService: PlatformWechatNativeService,
  ) {}

  /** 下单并返回二维码链接 */
  async createNativeOrder(
    params: CreateSmsNativeOrderParams,
  ): Promise<{ codeUrl: string }> {
    return this.platformNativeService.createNativeOrder({
      ...params,
      notifyUrl: this.getSmsNotifyUrl(),
      bizType: BIZ_TYPE,
    });
  }

  /**
   * 关闭微信侧订单。
   *
   * 本地订单过期只置 `closed` 是不够的：微信二维码最长 2 小时有效，
   * 本地 30 分钟就关，用户在两者之间扫码仍能付款成功，出现「前端提示已关单、钱照扣」。
   * 因此关本地单之前必须先关微信单。
   */
  async closeNativeOrder(orderNo: string): Promise<WechatCloseOrderResult> {
    return this.platformNativeService.closeNativeOrder(orderNo, BIZ_TYPE);
  }

  /**
   * 短信专用回调地址。
   *
   * 未配置 `SMS_WECHAT_PAY_NOTIFY_URL` 时**不回落到**其它链路的通配地址：
   * 那会让短信充值回调打到别的订单回调上，而后者根本不认识 SM 前缀订单，
   * 表现为「付了钱、钱包没到账」且无报错。宁可下单直接失败让人去配。
   */
  private getSmsNotifyUrl(): string {
    const configured = this.configService
      .get<string>('sms.wechatPayNotifyUrl')
      ?.trim();
    if (configured) {
      return configured;
    }
    throw new InternalServerErrorException(
      '环境变量 SMS_WECHAT_PAY_NOTIFY_URL 未配置，无法发起短信充值',
    );
  }
}
