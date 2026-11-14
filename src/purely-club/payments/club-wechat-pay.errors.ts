import { BadRequestException } from '@nestjs/common';
import {
  CLUB_LEGACY_ERROR_CODE,
  clubBusinessError,
} from '../shared/club-business-errors';

/**
 * 微信支付链路的业务错误码常量。
 *
 * 码值属于冻结的历史码（CLUB_LEGACY_ERROR_CODE），前端按 code 分支、
 * 不按文案匹配，因此禁止改名；文案可在不通知前端的前提下调整。
 */

/** 门店未配置微信收款（mchId / apiV3Key 缺失） */
export const STORE_PAY_CONFIG_MISSING_CODE =
  CLUB_LEGACY_ERROR_CODE.STORE_PAY_CONFIG_MISSING;
export const STORE_PAY_CONFIG_MISSING_MESSAGE =
  '该门店暂不支持在线充值，请联系门店';

/**
 * 门店收款身份缺失的统一异常构造器。
 * 下单 / 查单 / 关单 / 退款四个调用点共用，避免各自内联 { code, message }。
 */
export function buildStorePayConfigMissingError(): BadRequestException {
  return new BadRequestException(
    clubBusinessError(
      STORE_PAY_CONFIG_MISSING_CODE,
      STORE_PAY_CONFIG_MISSING_MESSAGE,
    ),
  );
}

/**
 * 小程序支付 AppID 与收款商户号不匹配。
 *
 * 服务商模式下这不是「配置缺失」而是「绑定关系没做完」：子商户号能被服务商识别
 * （绑定校验返回 ORDER_NOT_EXIST 即通过），但用于下单的小程序 AppID 没有关联到
 * 该子商户号，微信会直接拒绝下单。历史上这类失败被包成通用 500「支付失败」，
 * 商家与平台都无法从提示里定位到 AppID 这一环，因此单独给出稳定业务码。
 */
export const PAY_APPID_MCHID_MISMATCH_CODE =
  'CLUB_PAY_DEPENDENCY_APPID_MCHID_MISMATCH';
export const PAY_APPID_MCHID_MISMATCH_MESSAGE =
  '该门店的小程序支付 AppID 尚未与收款商户号关联，请联系平台完成授权后再试';

/** AppID 未与商户号关联异常构造器（下单失败分支专用） */
export function buildAppIdMchIdMismatchError(): BadRequestException {
  return new BadRequestException(
    clubBusinessError(
      PAY_APPID_MCHID_MISMATCH_CODE,
      PAY_APPID_MCHID_MISMATCH_MESSAGE,
    ),
  );
}

/**
 * 判断微信返回是否为「appid 与商户号不匹配」。
 *
 * 微信在不同 appid 组合下有两种表现，必须同时识别：
 * - `APPID_MCHID_NOT_MATCH`：appid 合法但未与商户号绑定；
 * - `INVALID_REQUEST` + `商户号mch_id与appid不匹配`：服务商模式下
 *   sp_appid 与 sub_appid 的类型/主体口径不一致时出现。
 *
 * 只按 code 判断会漏掉第二种，导致同一根因在两条路径上给出不同结论；
 * 下单失败映射与商家端绑定自检必须共用本函数，否则会出现
 * 「自检说没绑、下单说别的问题」这种互相矛盾的提示。
 */
export function isAppIdMchIdMismatch(
  code: string | null,
  message: string,
): boolean {
  if (code === 'APPID_MCHID_NOT_MATCH') {
    return true;
  }
  if (code !== 'INVALID_REQUEST') {
    return false;
  }
  const normalized = message.toLowerCase().replace(/\s+/g, '');
  return normalized.includes('appid') && normalized.includes('mch_id');
}
