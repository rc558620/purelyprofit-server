import { Logger } from '@nestjs/common';
import { reportStoreInviteQrBaseUrlStatus } from './store-invite-qr-base-url-status.utils';

/**
 * 启动期域名播报的单测。
 *
 * 注意：error 分支用「缺协议头的域名」（`club.purelyprofit.com`）触发 ——
 * 它在任何环境都会被 sanitize 拒绝，因此不需要改 NODE_ENV（项目规则禁止业务代码
 * 直接读环境变量，测试里同样不该靠改环境变量来触发分支）。
 *
 * 播报按域名取值去重，所以每个用例必须使用**不同的取值**，否则会被去重吃掉。
 */
describe('reportStoreInviteQrBaseUrlStatus', () => {
  let logger: Logger;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('StoreInviteQrBaseUrlStatusSpec');
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('未配置域名时 warn：进店码回退裸码，微信原生扫一扫无法唤起小程序', () => {
    reportStoreInviteQrBaseUrlStatus(logger, undefined);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('CLUB_PUBLIC_BASE_URL');
    expect(warnSpy.mock.calls[0][0]).toContain('回退为裸邀请码');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('配置了但被 sanitize 拒绝时 error：静默回退最危险，必须显式暴露', () => {
    // 缺协议头：任何环境都会被 sanitizePublicBaseUrl 拒绝
    reportStoreInviteQrBaseUrlStatus(logger, 'club.purelyprofit.com');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('club.purelyprofit.com');
    expect(errorSpy.mock.calls[0][0]).toContain('静默回退');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('域名生效时 log 并提示该域名是永久资产', () => {
    reportStoreInviteQrBaseUrlStatus(logger, 'https://club.purelyprofit.com');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain(
      'https://club.purelyprofit.com/i/v1/{inviteCode}',
    );
    expect(logSpy.mock.calls[0][0]).toContain('永久资产');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('按域名取值去重：多 service 接入也只播报一次，不会刷屏', () => {
    const anotherLogger = new Logger('AnotherService');
    const baseUrl = 'https://invite.purelyprofit.com';

    reportStoreInviteQrBaseUrlStatus(logger, baseUrl);
    reportStoreInviteQrBaseUrlStatus(anotherLogger, baseUrl);

    // 按取值去重：换一个 logger 再播报同一取值也不再输出
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain(baseUrl);
  });
});
