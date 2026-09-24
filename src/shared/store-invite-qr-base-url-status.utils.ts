import { Logger } from '@nestjs/common';
import {
  resolveAllowPrivateNetwork,
  sanitizePublicBaseUrl,
} from './qr-public-url.utils';

/**
 * 进店码（门店邀请码）域名（`CLUB_PUBLIC_BASE_URL`）启动期状态播报。
 *
 * 与 `scan-qr-base-url-status.utils.ts`（桌码 / 空间码的 `SCAN_QR_BASE_URL`）是两套
 * 独立的配置，因此分开播报；去重思路照搬：按「域名取值」去重，
 * 多个 service（`MarketingInviteCodeService` / `MarketingOverviewService` /
 * `MarketingInviteQrIssueService` 都读同一个 `club.publicBaseUrl`）
 * 即使都调用本函数，也只会播报一次，不会在启动日志里刷多遍。
 *
 * ⚠️ 必须播报的原因：域名一旦写进已印刷物料就是永久资产 ——
 * 换域名 / 备案注销 / 微信「扫普通链接二维码」规则被删，都会让全部已印物料
 * 同时失效，且服务端改不了纸上印的内容。历史上本域名**完全没有启动期告警**：
 * 只在创建渠道码时由 `hasPublicBaseUrl()` 运行期拒绝，通用进店码则静默回退裸码，
 * 运维无从察觉。所以「配了但被 sanitize 拒绝」这种静默回退必须显式暴露成 error。
 */

/** 上一次已播报的原始取值（去重用；按取值而不是按调用方去重）。 */
let reportedRawBaseUrl: string | null = null;

export function reportStoreInviteQrBaseUrlStatus(
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
      '未配置 CLUB_PUBLIC_BASE_URL：进店码回退为裸邀请码（legacy），' +
        '微信原生扫一扫无法唤起小程序，仅小程序内扫码可用',
    );
    return;
  }

  const sanitized = sanitizePublicBaseUrl(raw, resolveAllowPrivateNetwork());
  if (!sanitized) {
    logger.error(
      `CLUB_PUBLIC_BASE_URL="${raw}" 非法或在当前环境被拒绝，` +
        '进店码已静默回退为裸邀请码（legacy）。' +
        '请检查协议（仅 http/https）、是否带路径，以及生产环境是否填了内网地址',
    );
    return;
  }

  logger.log(
    `进店码域名已生效：${sanitized}/i/v1/{inviteCode}。` +
      '该域名与入口路径一经印刷即视为永久资产（只增不换），变更会使已印物料不可逆失效',
  );
}
