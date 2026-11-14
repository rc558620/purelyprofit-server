import type { ConfigService } from '@nestjs/config';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatSubMerchantVerifyService } from './club-wechat-sub-merchant-verify.service';

/** 关系探测通过（微信认识该子商户号，只是没有这笔单） */
const RELATION_OK = {
  ok: false,
  status: 404,
  code: 'ORDER_NOT_EXIST',
  message: '订单不存在',
};

/** AppID 探测通过：appid 校验已过，只差真实 openid */
const APPID_OK = {
  ok: false,
  status: 400,
  code: 'PARAM_ERROR',
  message: '无效的openid',
};

describe('ClubWechatSubMerchantVerifyService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.partner.spMchId': 'SP0001',
    'wechat.partner.spAppId': 'wx_partner_appid',
    'wechat.partner.subAppId': 'wx_club_miniprogram',
    'wechat.partner.notifyUrl': 'https://api.example.com/club/callback',
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
    configState['wechat.partner.spMchId'] = 'SP0001';
    configState['wechat.partner.spAppId'] = 'wx_partner_appid';
    configState['wechat.partner.subAppId'] = 'wx_club_miniprogram';
    configState['wechat.partner.notifyUrl'] =
      'https://api.example.com/club/callback';
  });

  // ─── 第一层：子商户 ↔ 服务商 ─────────────────────────────────────────────

  it('查单返回 ORDER_NOT_EXIST 视为绑定关系正常', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce(APPID_OK);

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('verified');
    expect(result.code).toBe('PARAM_ERROR');
  });

  it('查单返回 NO_AUTH 视为未绑定/未授权，且不再继续探测 AppID', async () => {
    httpService.request.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: 'NO_AUTH',
      message: '商户无权限',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('not_bound');
    expect(result.message).toContain('未授权');
    expect(httpService.request).toHaveBeenCalledTimes(1);
  });

  it('查单返回 MCH_NOT_EXISTS 视为子商户号不存在', async () => {
    httpService.request.mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: 'MCH_NOT_EXISTS',
      message: '商户号不存在',
    });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('not_bound');
    expect(result.message).toContain('不存在');
  });

  it('关系探测未预期错误码判定为未知，不误判为可用', async () => {
    httpService.request.mockResolvedValueOnce({
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
  });

  it('关系探测走 partner 路径并带上 sp_mchid 与 sub_mchid', async () => {
    httpService.request
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
        message: '',
      })
      .mockResolvedValueOnce(APPID_OK);

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

  // ─── 第二层：AppID ↔ 子商户（历史缺口） ───────────────────────────────────

  it('AppID 返回 APPID_MCHID_NOT_MATCH 判定为 appid_not_bound', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: 'APPID_MCHID_NOT_MATCH',
        message: 'appid和mch_id不匹配，请检查后再试',
      });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('appid_not_bound');
    expect(result.message).toContain('关联小程序');
  });

  it('AppID 返回 INVALID_REQUEST「商户号mch_id与appid不匹配」同样判定为 appid_not_bound', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: 'INVALID_REQUEST',
        message: '商户号mch_id与appid不匹配',
      });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('appid_not_bound');
    expect(result.code).toBe('INVALID_REQUEST');
  });

  it('AppID 探测返回未预期错误码判定为未知，不误判为可用', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        code: 'SYSTEM_ERROR',
        message: '系统繁忙',
      });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('unknown');
    expect(result.message).toContain('SYSTEM_ERROR');
  });

  it('AppID 探测意外下单成功时判定为未知，不误判为可用', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { prepay_id: 'x' },
      });

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('unknown');
  });

  it('AppID 探测未配置 sub_appid 时回落到 sp_openid', async () => {
    delete configState['wechat.partner.subAppId'];
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce(APPID_OK);

    await buildService().checkBind('SUB0001');

    const call = httpService.request.mock.calls[1][0];
    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(call.urlPath).toBe('/v3/pay/partner/transactions/jsapi');
    expect(body).not.toHaveProperty('sub_appid');
    expect(body.payer).toEqual({ sp_openid: expect.any(String) });
    expect(body.sub_mchid).toBe('SUB0001');
    expect(body.sp_appid).toBe('wx_partner_appid');
    expect((body.out_trade_no as string).startsWith('ZP')).toBe(true);
    expect(body.amount).toEqual({ total: 1, currency: 'CNY' });
  });

  it('AppID 探测在配置 sub_appid 时带上 sub_appid 与 sub_openid', async () => {
    httpService.request
      .mockResolvedValueOnce(RELATION_OK)
      .mockResolvedValueOnce(APPID_OK);

    await buildService().checkBind('SUB0001');

    const body = JSON.parse(
      httpService.request.mock.calls[1][0].body,
    ) as Record<string, unknown>;
    expect(body.sub_appid).toBe('wx_club_miniprogram');
    expect(body.payer).toEqual({ sub_openid: expect.any(String) });
  });

  it('AppID 未配置 sp_appid 时返回未知且不发起下单探测', async () => {
    delete configState['wechat.partner.spAppId'];
    httpService.request.mockResolvedValueOnce(RELATION_OK);

    const result = await buildService().checkBind('SUB0001');

    expect(result.status).toBe('unknown');
    expect(result.message).toContain('sp_appid');
    expect(httpService.request).toHaveBeenCalledTimes(1);
  });
});
