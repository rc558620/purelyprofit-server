/**
 * 门店微信收款的**支付身份**解析：回答「这笔钱用谁签名、落到谁账上、用哪个 AppID 下单」。
 *
 * 存在的理由：服务商模式改造后，门店侧有两套完全不同的收款口径——
 *
 *   直连（store）  signMchId = 门店自己的商户号          资金直接进该商户号
 *   服务商(partner) signMchId = 服务商商户号 + subMchId = 商家子商户号，资金进子商户
 *
 * 如果把这套判断散到下单 / 查单 / 关单 / 退款四个调用点各自写一遍，
 * 灰度期「什么时候回落到旧字段」的口径一定会漂移，表现就是
 * 「下单成功、退款却找不到商户号」这类只在特定组合下才炸的资金事故。
 *
 * 因此这里必须是唯一真相源：**只允许**从这里拿支付身份。
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';

/** 收款链路：store=旧直连普通商户；partner=服务商 + 子商户 */
export type WechatPayCollectionMode = 'store' | 'partner';

export interface ClubWechatPayTarget {
  /** 本次收款走哪条链路 */
  mode: WechatPayCollectionMode;
  /** 参与 Authorization 头 `mchid` 的商户号（**签名主体**，服务商模式下不是门店商户号） */
  signMchId: string;
  /** 资金结算去向商户号：服务商模式为子商户号，直连模式与 signMchId 同值 */
  settleMchId: string;
  /** 下单与前端拉起支付使用的 appid（服务商模式下为 sp_appid） */
  appId: string;
  /** 支付回调地址 */
  notifyUrl: string;
}

@Injectable()
export class ClubWechatPayIdentityService {
  private readonly logger = new Logger(ClubWechatPayIdentityService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storesWechatPayService: StoresWechatPayService,
  ) {}

  /** 服务商模式是否开启；false 时全链路回落旧的直连逻辑（灰度回滚开关） */
  isPartnerMode(): boolean {
    return this.configService.get<boolean>('wechat.partner.enabled') === true;
  }

  /**
   * 当前配置的服务商商户号（未配置时为空串）。
   *
   * 回调落账前要拿它与报文里的 sp_mchid 对账：不一致说明这笔回调不是本平台
   * 作为服务商收到的钱，或者配置被改错，属于必须拒绝入账的资金归属异常。
   */
  getPartnerSpMchId(): string {
    return (
      this.configService.get<string>('wechat.partner.spMchId')?.trim() ?? ''
    );
  }

  /**
   * 解析门店本次收款的支付身份。
   *
   * @returns null 表示门店尚未配置任何收款凭据（等价于「该门店不支持在线支付」），
   *          调用方必须按业务缺配处理，**不要**退化成「用平台商户号收」——
   *          那会把钱收进平台而不是商家，属资金归属事故。
   */
  async resolveTarget(storeId: number): Promise<ClubWechatPayTarget | null> {
    const config =
      await this.storesWechatPayService.getWechatPayConfigForStore(storeId);

    if (!config.mchId) {
      return null;
    }
    const mchId = config.mchId;

    if (this.isPartnerMode()) {
      return this.resolvePartnerTarget(storeId, {
        mchId,
        subMchId: config.subMchId,
        bindStatus: config.bindStatus,
      });
    }
    return this.resolveStoreTarget({ mchId });
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  /**
   * 服务商模式：签名主体是服务商商户号，商户
   * 号取自门店配置的子商户号（灰度期允许回落旧的 mch_id）。
   *
   * ⚠️ 这里**不要求**门店提供 APIv3 密钥：子商户在微信侧不存在、
   * 也不支持设置 APIv3 密钥（官方口径），硬要它填等于要求商家提供直连凭据。
   */
  private resolvePartnerTarget(
    storeId: number,
    config: {
      subMchId: string | null;
      mchId: string;
      bindStatus: string | null;
    },
  ): ClubWechatPayTarget | null {
    const settleMchId = config.subMchId?.trim() || config.mchId.trim();
    if (!settleMchId) {
      return null;
    }

    if (!config.subMchId?.trim()) {
      this.logger.warn(
        `门店 ${storeId} 未配置子商户号（sub_mch_id），本次下单回落到旧字段 mch_id=` +
          `${config.mchId}；迁移回填未完成时应尽快执行回填脚本`,
      );
    }
    if (config.bindStatus === 'failed') {
      this.logger.warn(
        `门店 ${storeId} 的子商户与服务商关系校验结果为 failed，继续下单可能失败`,
      );
    }

    return {
      mode: 'partner',
      signMchId: this.requireConfig(
        'wechat.partner.spMchId',
        '服务商商户号未配置，无法以下单主体身份请求微信支付',
      ),
      settleMchId,
      appId: this.requireConfig(
        'wechat.partner.spAppId',
        '服务商模式下的支付 AppID（sp_appid）未配置',
      ),
      notifyUrl: this.requireConfig(
        'wechat.partner.notifyUrl',
        '服务商模式下的支付回调地址未配置，微信支付成功后无法通知到平台',
      ),
    };
  }

  /** 直连模式：门店自己的商户号既是签名主体也是收款方（改造前的行为，保持零变化） */
  private resolveStoreTarget(config: { mchId: string }): ClubWechatPayTarget {
    return {
      mode: 'store',
      signMchId: config.mchId,
      settleMchId: config.mchId,
      appId: this.requireConfig('wechat.appId', '微信 AppID 未配置，无法下单'),
      notifyUrl: this.requireConfig(
        'wechat.payNotifyUrl',
        '微信支付回调地址未配置，支付成功后无法通知到平台',
      ),
    };
  }

  /**
   * 读取必填配置：缺失时抛语义化异常，便于前端直接展示中文原因。
   */
  private requireConfig(key: string, message: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      this.logger.error(`${key} 未配置：${message}`);
      throw new InternalServerErrorException(message);
    }
    return value;
  }
}
