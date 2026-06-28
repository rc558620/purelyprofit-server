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
  const wechatPlatformPublicKey = getTrimmedConfigValue(
    configService,
    'wechat.platformPublicKeyContent',
  );
  const manualConfirmPaidEnabled =
    configService.get<boolean>('club.manualConfirmPaidEnabled') ?? false;
  const portAutoTerminateEnabled =
    configService.get<boolean>('app.portAutoTerminateEnabled') ?? false;
  const portAutoShiftEnabled =
    configService.get<boolean>('app.portAutoShiftEnabled') ?? false;
  const swaggerEnabled =
    configService.get<boolean>('app.swaggerEnabled') ?? false;

  const adminLoginAlias = getTrimmedConfigValue(configService, 'auth.adminLoginAlias');
  const adminLoginPhone = getTrimmedConfigValue(configService, 'auth.adminLoginPhone');

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
    errors.push('auth.adminLoginAlias 生产环境不可使用默认值 "admin"，请通过 AUTH_ADMIN_LOGIN_ALIAS 设置自定义别名');
  }

  if (adminLoginPhone === '13619654020') {
    errors.push('auth.adminLoginPhone 生产环境不可使用默认值，请通过 AUTH_ADMIN_LOGIN_PHONE 设置自定义手机号');
  }

  if (errors.length > 0) {
    throw new Error(`[bootstrap] 生产配置校验失败:\n- ${errors.join('\n- ')}`);
  }
}
