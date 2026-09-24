import { Logger } from '@nestjs/common';
import {
  resolveAllowPrivateNetwork,
  sanitizePublicBaseUrl,
} from './qr-public-url.utils';

/**
 * 扫码域名（`SCAN_QR_BASE_URL`）启动期状态播报。
 *
 * 桌码（`{base}/t/{token}`）与空间码（`{base}/p/{token}`）共用同一个域名配置，
 * 因此域名状态是**配置的属性**，不是某个 service 的属性：这里按「域名取值」去重，
 * 两个 service（`ScanOrderingQrService` / `SpaceQrCodeService`）都调用本函数
 * 也只会播报一次，不会在启动日志里刷两遍。
 *
 * ⚠️ 必须播报的原因：域名一旦写进已印刷物料就是永久资产 ——
 * 换域名 / 备案注销 / 微信「扫普通链接二维码」规则被删，都会让全部已印物料
 * 同时失效，且服务端改不了纸上印的内容。所以「配了但被 sanitize 拒绝」
 * 这种**静默回退**必须显式暴露成 error，而不是让运维以为已经生效。
 */

/** 上一次已播报的原始取值（去重用；按取值而不是按调用方去重）。 */
let reportedRawBaseUrl: string | null = null;

export function reportScanQrBaseUrlStatus(
  logger: Logger,
  rawBaseUrl: string | undefined,
): void {
  const raw = (rawBaseUrl ?? '').trim();
  if (reportedRawBaseUrl === raw) {
    return;
  }
  reportedRawBaseUrl = raw;

  if (!raw) {
    logger.warn(
      '未配置 SCAN_QR_BASE_URL：桌码回退为裸 token、空间码回退为 purelyclub:// 自定义协议，' +
        '微信原生扫一扫无法唤起小程序，仅小程序内扫码可用',
    );
    return;
  }

  const sanitized = sanitizePublicBaseUrl(raw, resolveAllowPrivateNetwork());
  if (!sanitized) {
    logger.error(
      `SCAN_QR_BASE_URL="${raw}" 非法或在当前环境被拒绝，` +
        '桌码已静默回退为裸 token、空间码已静默回退为 purelyclub:// 自定义协议。' +
        '请检查协议（仅 http/https）、是否带路径、以及生产环境是否填了内网地址',
    );
    return;
  }

  logger.log(
    `扫码域名已生效：${sanitized}/t/{token}（桌码）、${sanitized}/p/{token}（空间码）。` +
      '该域名视为永久资产，变更会使已印刷物料不可逆失效',
  );
}
