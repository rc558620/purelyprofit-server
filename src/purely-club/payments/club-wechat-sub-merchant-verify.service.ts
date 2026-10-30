/**
 * 子商户绑定关系校验（服务商模式）。
 *
 * 原理：以「服务商商户号 + 子商户号」去查一个**必然不存在**的商户订单号，
 * 按微信返回码反推绑定关系 —— 这是微信官方推荐的轻量探测方式：
 *
 *   ORDER_NOT_EXIST / NOT_FOUND  → 微信认识这个子商户号，关系正常（可以收款）
 *   NO_AUTH                      → 该子商户号未与本服务商绑定，或未授权
 *   MCH_NOT_EXISTS               → 子商户号在微信侧不存在（填错了）
 *   其它 / 网络异常              → 未知，不能据此判定可用或不可用
 *
 * ⚠️ 探测单号必须用不可能与真实订单冲突的前缀：真实订单号前缀是
 * RC / SV / SO / VC / SF，这里用 ZQ，且不落任何库表。
 */
import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';

/** 绑定关系校验结论 */
export type SubMerchantBindStatus = 'verified' | 'not_bound' | 'unknown';

export interface SubMerchantBindCheckResult {
  status: SubMerchantBindStatus;
  /** 微信原始错误码（用于日志与排障） */
  code: string | null;
  /** 可直接展示给商家的中文结论 */
  message: string;
}

/** 探测单号前缀：与真实订单前缀（RC/SV/SO/VC/SF）不重叠 */
const PROBE_ORDER_NO_PREFIX = 'ZQ';

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

@Injectable()
export class ClubWechatSubMerchantVerifyService {
  private readonly logger = new Logger(ClubWechatSubMerchantVerifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: ClubWechatPayHttpService,
  ) {}

  /**
   * 校验子商户号与服务商的绑定关系。
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

    const probeOrderNo = this.buildProbeOrderNo();
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

  /** 构造不可能与真实订单冲突的探测单号 */
  private buildProbeOrderNo(): string {
    return `${PROBE_ORDER_NO_PREFIX}${Date.now()}${randomBytes(4).toString('hex')}`;
  }
}
