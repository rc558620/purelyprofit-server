/**
 * 子商户收款能力校验（服务商模式）。
 *
 * 校验分两层，缺一层就会出现「后台显示已配置、实际收不到钱」的静默故障：
 *
 *   1. **子商户 ↔ 服务商**：以「服务商商户号 + 子商户号」查一个必然不存在的商户订单，
 *      按微信返回码反推绑定关系 —— 微信官方推荐的轻量探测方式：
 *        ORDER_NOT_EXIST / NOT_FOUND  → 微信认识这个子商户号，关系正常
 *        NO_AUTH                      → 该子商户号未与本服务商绑定，或未授权
 *        MCH_NOT_EXISTS               → 子商户号在微信侧不存在（填错了）
 *   2. **AppID ↔ 子商户**：用一次「假 openid」的 JSAPI 下单探测。
 *      微信的校验顺序是 appid/商户号 → openid，因此：
 *        返回 PARAM_ERROR「无效的openid」     → appid 与商户号已匹配（只缺真实 openid）
 *        返回 APPID_MCHID_NOT_MATCH 等        → 小程序 AppID 未与子商户号关联
 *      这一层是历史缺口：只看第 1 层时，商家端会显示「已配置」，
 *      真机下单却报「商户号 mch_id 与 appid 不匹配」。
 *
 * ⚠️ 探测单号必须用不可能与真实订单冲突的前缀：真实订单号前缀是
 * RC / SV / SO / VC / SF，查单探测用 ZQ，下单探测用 ZP，且不落任何库表。
 */
import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { isAppIdMchIdMismatch } from './club-wechat-pay.errors';

/** 绑定关系校验结论 */
export type SubMerchantBindStatus =
  | 'verified'
  | 'not_bound'
  | 'appid_not_bound'
  | 'unknown';

export interface SubMerchantBindCheckResult {
  status: SubMerchantBindStatus;
  /** 微信原始错误码（用于日志与排障） */
  code: string | null;
  /** 可直接展示给商家的中文结论 */
  message: string;
}

/** 查单探测单号前缀：与真实订单前缀（RC/SV/SO/VC/SF）不重叠 */
const QUERY_PROBE_ORDER_NO_PREFIX = 'ZQ';
/** 下单探测单号前缀：与查单探测、真实订单都不重叠 */
const APPID_PROBE_ORDER_NO_PREFIX = 'ZP';

/** 关系正常：微信认识这个子商户号，只是没有这笔单 */
const BIND_OK_CODES = ['ORDER_NOT_EXIST', 'NOT_FOUND', 'ORDERNOTEXIST'];
/** 未绑定 / 未授权 / 商户号不存在 */
const BIND_FAIL_CODES = ['NO_AUTH', 'MCH_NOT_EXISTS', 'MCHID_NOT_EXIST'];

const BIND_FAIL_MESSAGES: Record<string, string> = {
  NO_AUTH:
    '该子商户号尚未与本平台服务商绑定或未授权，请在微信支付服务商后台完成绑定后再校验',
  MCH_NOT_EXISTS: '该子商户号在微信支付侧不存在，请核对填写是否正确',
  MCHID_NOT_EXIST: '该子商户号在微信支付侧不存在，请核对填写是否正确',
};

/** 探测下单用的占位 openid：无需真实用户，仅用于触碰 appid 校验 */
const PROBE_OPENID = 'oProbeAppIdBinding0000000000000000';
/** 未配置服务商回调地址时的占位 notify_url（微信仅要求 HTTPS 形态） */
const FALLBACK_NOTIFY_URL = 'https://example.com/club/pay/probe';

@Injectable()
export class ClubWechatSubMerchantVerifyService {
  private readonly logger = new Logger(ClubWechatSubMerchantVerifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: ClubWechatPayHttpService,
  ) {}

  /**
   * 校验子商户的收款能力：先查绑定关系，再验 AppID 是否已关联到该子商户号。
   *
   * @param subMchId 门店配置的子商户号
   */
  async checkBind(subMchId: string): Promise<SubMerchantBindCheckResult> {
    const spMchId = this.configService
      .get<string>('wechat.partner.spMchId')
      ?.trim();

    if (!spMchId) {
      return {
        status: 'unknown',
        code: null,
        message: '平台尚未配置服务商商户号，无法校验子商户绑定关系',
      };
    }

    const relation = await this.probeMerchantRelation(spMchId, subMchId);
    if (relation.status !== 'verified') {
      return relation;
    }

    // 关系正常不代表能收款：小程序 AppID 未关联到该子商户号时，下单必失败
    return this.probeAppIdBinding(spMchId, subMchId);
  }

  // ─── 第一层：子商户 ↔ 服务商 ──────────────────────────────────────────────

  /** 用「必然不存在的商户订单号」探测子商户号与服务商的关系 */
  private async probeMerchantRelation(
    spMchId: string,
    subMchId: string,
  ): Promise<SubMerchantBindCheckResult> {
    const probeOrderNo = this.buildProbeOrderNo(QUERY_PROBE_ORDER_NO_PREFIX);
    const query =
      `sp_mchid=${encodeURIComponent(spMchId)}` +
      `&sub_mchid=${encodeURIComponent(subMchId)}`;

    const result = await this.httpService.request<unknown>({
      method: 'GET',
      urlPath: `/v3/pay/partner/transactions/out-trade-no/${probeOrderNo}`,
      mchId: spMchId,
      credential: 'partner',
      query,
    });

    if (result.ok) {
      // 探测单号撞上真实订单的概率可忽略；真撞上说明探测逻辑需要改，不能判为可用
      this.logger.error(
        `子商户绑定探测命中真实订单 subMchId=${subMchId} probe=${probeOrderNo}，判定为未知`,
      );
      return {
        status: 'unknown',
        code: null,
        message: '绑定关系探测异常，请稍后重试',
      };
    }

    const code = result.code ?? '';
    if (BIND_OK_CODES.includes(code)) {
      return {
        status: 'verified',
        code,
        message: '子商户绑定关系正常，可以正常收款',
      };
    }

    if (BIND_FAIL_CODES.includes(code)) {
      return {
        status: 'not_bound',
        code,
        message:
          BIND_FAIL_MESSAGES[code] ??
          '该子商户号与本平台服务商的关系校验未通过',
      };
    }

    this.logger.warn(
      `子商户绑定探测返回未预期错误码 subMchId=${subMchId} ` +
        `httpStatus=${result.status} wechatCode=${code || 'EMPTY'} message=${result.message}`,
    );
    return {
      status: 'unknown',
      code: code || null,
      message: `暂时无法确认绑定关系（微信返回 ${code || '空错误码'}），请稍后重试`,
    };
  }

  // ─── 第二层：AppID ↔ 子商户 ───────────────────────────────────────────────

  /**
   * 用一次假 openid 的 JSAPI 下单探测 AppID 是否已关联到子商户号。
   *
   * 之所以不真下单：微信在 appid/商户号校验失败时直接拒绝，不会创建订单；
   * 校验通过后才会因 openid 无效而失败，同样不会落单。因此整个过程零脏数据。
   */
  private async probeAppIdBinding(
    spMchId: string,
    subMchId: string,
  ): Promise<SubMerchantBindCheckResult> {
    const spAppId = this.configService
      .get<string>('wechat.partner.spAppId')
      ?.trim();
    if (!spAppId) {
      return {
        status: 'unknown',
        code: null,
        message: '平台未配置服务商小程序 AppID（sp_appid），无法校验收款 AppID',
      };
    }

    const subAppId = this.configService
      .get<string>('wechat.partner.subAppId')
      ?.trim();
    const notifyUrl =
      this.configService.get<string>('wechat.partner.notifyUrl')?.trim() ||
      FALLBACK_NOTIFY_URL;

    const body = JSON.stringify({
      sp_appid: spAppId,
      sp_mchid: spMchId,
      ...(subAppId ? { sub_appid: subAppId } : {}),
      sub_mchid: subMchId,
      description: '收款能力探测',
      out_trade_no: this.buildProbeOrderNo(APPID_PROBE_ORDER_NO_PREFIX),
      notify_url: notifyUrl,
      amount: { total: 1, currency: 'CNY' },
      payer: subAppId
        ? { sub_openid: PROBE_OPENID }
        : { sp_openid: PROBE_OPENID },
    });

    const result = await this.httpService.request<unknown>({
      method: 'POST',
      urlPath: '/v3/pay/partner/transactions/jsapi',
      mchId: spMchId,
      credential: 'partner',
      body,
    });

    if (result.ok) {
      // 假 openid 不可能下单成功；真成功说明探测行为异常，不能判为可用
      this.logger.error(
        `AppID 关联探测意外下单成功 subMchId=${subMchId}，判定为未知，需人工核查`,
      );
      return {
        status: 'unknown',
        code: null,
        message: '收款 AppID 探测异常，请稍后重试',
      };
    }

    const code = result.code ?? null;
    if (isAppIdMchIdMismatch(code, result.message)) {
      this.logger.warn(
        `子商户 AppID 未关联 subMchId=${subMchId} spAppId=${spAppId} ` +
          `subAppId=${subAppId ?? '-'} wechatCode=${code ?? 'EMPTY'}`,
      );
      return {
        status: 'appid_not_bound',
        code,
        message:
          '该商户号尚未关联小程序的支付 AppID，请联系平台在微信支付服务商后台为商户号关联小程序后再校验',
      };
    }

    // 通过了 appid 校验，卡在 openid 属预期结果
    if (code === 'PARAM_ERROR' && /openid/i.test(result.message)) {
      return {
        status: 'verified',
        code,
        message: '子商户绑定关系与收款 AppID 均正常，可以正常收款',
      };
    }

    this.logger.warn(
      `子商户 AppID 探测返回未预期错误码 subMchId=${subMchId} ` +
        `httpStatus=${result.status} wechatCode=${code ?? 'EMPTY'} message=${result.message}`,
    );
    return {
      status: 'unknown',
      code,
      message: `暂时无法确认收款 AppID 关联（微信返回 ${code || '空错误码'}），请稍后重试`,
    };
  }

  /** 构造不可能与真实订单冲突的探测单号 */
  private buildProbeOrderNo(prefix: string): string {
    return `${prefix}${Date.now()}${randomBytes(4).toString('hex')}`;
  }
}
