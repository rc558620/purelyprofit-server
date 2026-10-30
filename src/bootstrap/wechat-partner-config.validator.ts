import { existsSync } from 'node:fs';
import type { ConfigService } from '@nestjs/config';

/** C 端门店收款（链路 a）在服务商模式下的回调路由后缀，其它链路的回调地址不可复用 */
const CLUB_CALLBACK_PATH = '/api/club/payments/wechat/callback';

function getTrimmedConfigValue(
  configService: ConfigService,
  key: string,
): string {
  return configService.get<string>(key)?.trim() ?? '';
}

/**
 * 【服务商模式 · 隔离新增】校验 wechat.partner.* 配置是否可用。
 *
 * 仅在 wechat.partner.enabled=true 时由 production-config.utils 调用：
 * 开关关闭代表链路 a 仍走旧直连逻辑，不能因为「未来才会用到的配置」
 * 把现有部署判成缺变量。本函数只向 errors 追加，不触碰既有 b/c 链路的校验结论。
 */
export function appendWechatPartnerErrors(
  configService: ConfigService,
  errors: string[],
): void {
  const spMchId = getTrimmedConfigValue(
    configService,
    'wechat.partner.spMchId',
  );
  const apiV3Key = getTrimmedConfigValue(
    configService,
    'wechat.partner.apiV3Key',
  );
  const serialNo = getTrimmedConfigValue(
    configService,
    'wechat.partner.serialNo',
  );
  const privateKeyPath = getTrimmedConfigValue(
    configService,
    'wechat.partner.privateKeyPath',
  );
  const privateKeyContent = getTrimmedConfigValue(
    configService,
    'wechat.partner.privateKeyContent',
  );
  const platformPublicKey = getTrimmedConfigValue(
    configService,
    'wechat.partner.platformPublicKeyContent',
  );
  const notifyUrl = getTrimmedConfigValue(
    configService,
    'wechat.partner.notifyUrl',
  );

  if (!spMchId) {
    errors.push(
      'wechat.partner.spMchId 未配置，服务商模式无法确定请求主体商户号',
    );
  }
  if (!apiV3Key) {
    errors.push(
      'wechat.partner.apiV3Key 未配置，服务商模式下 C 端支付回调报文无法解密（子商户没有自己的 APIv3 密钥）',
    );
  }
  if (!serialNo || serialNo.includes('your_mch_api_certificate_serial_no')) {
    errors.push('wechat.partner.serialNo 未配置或仍在使用示例值');
  }
  if (!privateKeyPath && !privateKeyContent) {
    errors.push(
      'wechat.partner.privateKeyPath / wechat.partner.privateKeyContent 至少要配置一个',
    );
  }
  if (privateKeyPath && !existsSync(privateKeyPath)) {
    errors.push('wechat.partner.privateKeyPath 指向的文件不存在');
  }
  if (!platformPublicKey) {
    errors.push(
      'wechat.partner.platformPublicKeyContent 未配置，服务商模式下 C 端支付回调无法 RSA 验签',
    );
  }
  appendPartnerNotifyUrlError(notifyUrl, errors);
  appendSharedMchIdErrors(configService, spMchId, errors);
}

/**
 * 服务商模式回调地址必须指向 C 端订单回调路由且为正式 HTTPS 地址。
 * 与 sms / profit 两条链路的回调地址各司其职，混用会把别链路订单当成 C 端订单入账。
 */
function appendPartnerNotifyUrlError(
  notifyUrl: string,
  errors: string[],
): void {
  if (!notifyUrl) {
    errors.push(
      `wechat.partner.notifyUrl（WECHAT_PARTNER_PAY_NOTIFY_URL）未配置，服务商模式无法下单，须指向 ${CLUB_CALLBACK_PATH}`,
    );
    return;
  }
  if (
    !notifyUrl.startsWith('https://') ||
    notifyUrl.includes('yourdomain.com')
  ) {
    errors.push(
      'wechat.partner.notifyUrl 必须是可访问的 HTTPS 正式地址（非示例域名）',
    );
    return;
  }
  if (!notifyUrl.endsWith(CLUB_CALLBACK_PATH)) {
    errors.push(
      `wechat.partner.notifyUrl 必须以 ${CLUB_CALLBACK_PATH} 结尾，与其它两条支付链路的回调地址不可混用`,
    );
  }
}

/**
 * 资金归属红线：服务商商户号不得与平台自收商户号相同。
 *
 * 相同意味着「C 端付款落进平台账户」而非结算到目标商家子商户。
 * 只有在明确确认「该商户号本身就是服务商号」时才能豁免，且必须填写原因留档。
 */
function appendSharedMchIdErrors(
  configService: ConfigService,
  spMchId: string,
  errors: string[],
): void {
  const payMchId = getTrimmedConfigValue(configService, 'wechat.payMchId');
  if (!spMchId || !payMchId || spMchId !== payMchId) {
    return;
  }
  const allowShared =
    configService.get<boolean>('wechat.partner.allowSharedPlatformMchId') ===
    true;
  if (!allowShared) {
    errors.push(
      'wechat.partner.spMchId 与 wechat.payMchId 相同，会造成 C 端资金落入平台而非目标商家；' +
        '若该商户号确为服务商商户号，请显式配置 WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID=true 并填写原因',
    );
    return;
  }
  const reason = getTrimmedConfigValue(
    configService,
    'wechat.partner.sharedMchIdReason',
  );
  if (!reason) {
    errors.push(
      '已豁免 spMchId 与 payMchId 相同，但未填写 wechat.partner.sharedMchIdReason（WECHAT_PARTNER_SHARED_MCH_ID_REASON），缺少资金归属留档',
    );
  }
}
