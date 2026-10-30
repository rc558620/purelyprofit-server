import type { ConfigService } from '@nestjs/config';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatSubMerchantVerifyService } from './club-wechat-sub-merchant-verify.service';

describe('ClubWechatSubMerchantVerifyService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.partner.spMchId': 'SP0001',
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };
  const httpService = { request: jest.fn() };

  const buildService = () =>
    new ClubWechatSubMerchantVerifyService(
      configService as unknown as ConfigService,
      httpService as unknown as ClubWechatPayHttpService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('查单返回 ORDER_NOT_EXIST 视为绑定关系正常', async () => {
    httpService.request.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'ORDER_NOT_EXIST',
      message: '订单不存在',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('verified');
    expect(result.code).toBe('ORDER_NOT_EXIST');
  });

  it('查单返回 NO_AUTH 视为未绑定/未授权', async () => {
    httpService.request.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'NO_AUTH',
      message: '商户无权限',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('not_bound');
    expect(result.message).toContain('未授权');
  });

  it('查单返回 MCH_NOT_EXISTS 视为子商户号不存在', async () => {
    httpService.request.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'MCH_NOT_EXISTS',
      message: '商户号不存在',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('not_bound');
    expect(result.message).toContain('不存在');
  });

  it('未预期错误码判定为未知，不误判为可用', async () => {
    httpService.request.mockResolvedValue({
      ok: false,
      status: 500,
      code: 'SYSTEM_ERROR',
      message: '系统错误',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('unknown');
    expect(result.message).toContain('SYSTEM_ERROR');
  });

  it('服务商商户号未配置时不发起请求', async () => {
    delete configState['wechat.partner.spMchId'];

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('unknown');
    expect(httpService.request).not.toHaveBeenCalled();

    configState['wechat.partner.spMchId'] = 'SP0001';
  });

  it('探测请求走 partner 路径并带上 sp_mchid 与 sub_mchid', async () => {
    httpService.request.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: '',
    });

    await buildService().checkBind('SUB0001');

    const call = httpService.request.mock.calls[0][0];
    expect(call.credential).toBe('partner');
    expect(call.mchId).toBe('SP0001');
    expect(call.query).toBe('sp_mchid=SP0001&sub_mchid=SUB0001');
    // 探测单号必须避开真实订单前缀（RC/SV/SO/VC/SF），否则可能撞上真实订单
    expect(call.urlPath).toContain(
      '/v3/pay/partner/transactions/out-trade-no/ZQ',
    );
  });
});
