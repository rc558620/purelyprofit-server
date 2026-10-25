import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';

function getTrimmedConfigValue(
  configService: ConfigService,
  key: string,
): string {
  return configService.get<string>(key)?.trim() ?? '';
}

export function validateProductionConfiguration(
  configService: ConfigService,
): void {
  const errors: string[] = [];
  const corsOrigin = getTrimmedConfigValue(configService, 'app.corsOrigin');
  const databaseUrl = getTrimmedConfigValue(configService, 'database.url');
  const jwtSecret = getTrimmedConfigValue(configService, 'jwt.secret');
  const redisHost = getTrimmedConfigValue(configService, 'redis.host');
  const wechatAppId = getTrimmedConfigValue(configService, 'wechat.appId');
  const wechatAppSecret = getTrimmedConfigValue(
    configService,
    'wechat.appSecret',
  );
  const wechatNotifyUrl = getTrimmedConfigValue(
    configService,
    'wechat.payNotifyUrl',
  );
  const wechatMchSerialNo = getTrimmedConfigValue(
    configService,
    'wechat.mchSerialNo',
  );
  const wechatPrivateKeyPath = getTrimmedConfigValue(
    configService,
    'wechat.privateKeyPath',
  );
  const wechatPrivateKeyContent = getTrimmedConfigValue(
    configService,
    'wechat.privateKeyContent',
  );
  // 平台收款商户号与其 APIv3 密钥：短信钱包充值走的是 Native 真实下单 + 回调验签解密，
  // 缺任一都会在「用户已扫码付款、后端无法解密回调」时才炸，必须在启动期就拦下
  const wechatPayMchId = getTrimmedConfigValue(
    configService,
    'wechat.payMchId',
  );
  const wechatPayApiV3Key = getTrimmedConfigValue(
    configService,
    'wechat.payApiV3Key',
  );
  const wechatPlatformPublicKey = getTrimmedConfigValue(
    configService,
    'wechat.platformPublicKeyContent',
  );
  const manualConfirmPaidEnabled =
    configService.get<boolean>('club.manualConfirmPaidEnabled') ?? false;
  const paymentModeSwitchEnabled =
    configService.get<boolean>('club.paymentModeSwitchEnabled') ?? false;
  // 商家端平台收款（会员订阅 / 新客额度充值）回调地址：缺失时只能等用户
  // 点了付款才暴露「下不了单」，必须在启动期就拦下
  const profitWechatPayNotifyUrl = getTrimmedConfigValue(
    configService,
    'profit.wechatPayNotifyUrl',
  );
  const profitManualPaidEnabled =
    configService.get<boolean>('profit.manualPaidEnabled') ?? false;
  const profitPaymentModeSwitchEnabled =
    configService.get<boolean>('profit.paymentModeSwitchEnabled') ?? false;
  // 跳过微信回调验签：true = 只校验时间戳，报文可被伪造，生产必须关闭
  const wechatAllowInsecureCallback =
    configService.get<boolean>('wechat.allowInsecureCallback') ?? false;
  // 短信充值回调地址：漏配时服务能正常启动，直到商家真去充值才 500
  const smsWechatPayNotifyUrl = getTrimmedConfigValue(
    configService,
    'sms.wechatPayNotifyUrl',
  );
  const portAutoTerminateEnabled =
    configService.get<boolean>('app.portAutoTerminateEnabled') ?? false;
  const portAutoShiftEnabled =
    configService.get<boolean>('app.portAutoShiftEnabled') ?? false;
  const swaggerEnabled =
    configService.get<boolean>('app.swaggerEnabled') ?? false;

  const adminLoginAlias = getTrimmedConfigValue(
    configService,
    'auth.adminLoginAlias',
  );
  const adminLoginPhone = getTrimmedConfigValue(
    configService,
    'auth.adminLoginPhone',
  );

  if (!databaseUrl) {
    errors.push('database.url 未配置');
  }

  if (!redisHost) {
    errors.push('redis.host 未配置');
  }

  if (!jwtSecret || jwtSecret === 'secret') {
    errors.push('jwt.secret 未配置或仍在使用默认值');
  }

  if (
    !corsOrigin ||
    corsOrigin === '*' ||
    corsOrigin.includes('yourdomain.com')
  ) {
    errors.push('app.corsOrigin 生产环境必须配置为正式域名白名单');
  }

  if (!wechatAppId || wechatAppId.startsWith('wx_your_')) {
    errors.push('wechat.appId 未配置或仍在使用示例值');
  }

  if (
    !wechatAppSecret ||
    wechatAppSecret.includes('your_miniprogram_appsecret')
  ) {
    errors.push('wechat.appSecret 未配置或仍在使用示例值');
  }

  if (
    !wechatMchSerialNo ||
    wechatMchSerialNo.includes('your_mch_api_certificate_serial_no')
  ) {
    errors.push('wechat.mchSerialNo 未配置或仍在使用示例值');
  }

  if (!wechatPayMchId) {
    errors.push('wechat.payMchId 未配置，平台收款链路无法真实下单');
  }

  if (!wechatPayApiV3Key) {
    errors.push('wechat.payApiV3Key 未配置，生产环境无法解密微信支付回调报文');
  }

  if (!wechatPrivateKeyPath && !wechatPrivateKeyContent) {
    errors.push(
      'wechat.privateKeyPath / wechat.privateKeyContent 至少要配置一个',
    );
  }

  if (wechatPrivateKeyPath && !existsSync(wechatPrivateKeyPath)) {
    errors.push('wechat.privateKeyPath 指向的文件不存在');
  }

  if (!wechatPlatformPublicKey) {
    errors.push(
      'wechat.platformPublicKeyContent 未配置，生产环境必须启用微信支付回调 RSA 验签',
    );
  }

  if (
    !wechatNotifyUrl ||
    !wechatNotifyUrl.startsWith('https://') ||
    wechatNotifyUrl.includes('yourdomain.com')
  ) {
    errors.push('wechat.payNotifyUrl 生产环境必须是可访问的 HTTPS 正式地址');
  }

  if (manualConfirmPaidEnabled) {
    errors.push('club.manualConfirmPaidEnabled 生产环境必须为 false');
  }

  // 运行期支付模式切换会在缺乏任何 brake 的情况下让人把测试订单打成真实扣款，
  // 因此必须与手动确认支付同等对待：生产环境强制关闭
  if (paymentModeSwitchEnabled) {
    errors.push('club.paymentModeSwitchEnabled 生产环境必须为 false');
  }

  if (
    !profitWechatPayNotifyUrl ||
    !profitWechatPayNotifyUrl.startsWith('https://') ||
    profitWechatPayNotifyUrl.includes('yourdomain.com')
  ) {
    errors.push(
      'profit.wechatPayNotifyUrl（PROFIT_WECHAT_PAY_NOTIFY_URL）生产环境必须是可访问的 HTTPS 正式地址',
    );
  }

  if (profitManualPaidEnabled) {
    errors.push('profit.manualPaidEnabled 生产环境必须为 false');
  }

  if (profitPaymentModeSwitchEnabled) {
    errors.push('profit.paymentModeSwitchEnabled 生产环境必须为 false');
  }

  if (wechatAllowInsecureCallback) {
    errors.push(
      'wechat.allowInsecureCallback（WECHAT_ALLOW_INSECURE_CALLBACK）生产环境必须为 false，否则支付回调可被伪造',
    );
  }

  // 短信充值回调地址：漏配时服务能正常启动，直到商家真去充值才 500，
  // 属于「上线后才发现」的典型事故，必须前移到启动校验
  if (
    !smsWechatPayNotifyUrl ||
    !smsWechatPayNotifyUrl.startsWith('https://') ||
    smsWechatPayNotifyUrl.includes('yourdomain.com')
  ) {
    errors.push(
      'sms.wechatPayNotifyUrl（SMS_WECHAT_PAY_NOTIFY_URL）生产环境必须是可访问的 HTTPS 正式地址，否则短信充值无法下单',
    );
  }

  if (portAutoTerminateEnabled) {
    errors.push('app.portAutoTerminateEnabled 生产环境必须关闭');
  }

  if (portAutoShiftEnabled) {
    errors.push('app.portAutoShiftEnabled 生产环境必须关闭');
  }

  if (swaggerEnabled) {
    errors.push('app.swaggerEnabled 生产环境必须关闭');
  }

  if (adminLoginAlias === 'admin') {
    errors.push(
      'auth.adminLoginAlias 生产环境不可使用默认值 "admin"，请通过 AUTH_ADMIN_LOGIN_ALIAS 设置自定义别名',
    );
  }

  if (adminLoginPhone === '13619654020') {
    errors.push(
      'auth.adminLoginPhone 生产环境不可使用默认值，请通过 AUTH_ADMIN_LOGIN_PHONE 设置自定义手机号',
    );
  }

  if (errors.length > 0) {
    throw new Error(`[bootstrap] 生产配置校验失败:\n- ${errors.join('\n- ')}`);
  }
}
