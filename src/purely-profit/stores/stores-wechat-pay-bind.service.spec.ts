import { BadRequestException } from '@nestjs/common';
import { ClubWechatSubMerchantVerifyService } from '../../purely-club/payments/club-wechat-sub-merchant-verify.service';
import { StoresWechatPayBindService } from './stores-wechat-pay-bind.service';

describe('StoresWechatPayBindService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.partner.enabled': true,
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };

  // 状态回写走 updateMany（带 subMchId 前置条件），不再用无条件 update
  const prisma = {
    storeWechatPayConfig: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const storesReadService = { getBoundStoreRecordOrThrow: jest.fn() };
  const subMerchantVerifyService = { checkBind: jest.fn() };

  const user = { id: 7 } as never;

  const buildService = (): StoresWechatPayBindService =>
    new StoresWechatPayBindService(
      prisma as never,
      storesReadService as never,
      configService as never,
      subMerchantVerifyService as unknown as ClubWechatSubMerchantVerifyService,
    );

  const storedConfig = {
    mchId: '1234567890',
    mchName: '纯利小店',
    apiV3KeyEnc: '',
    subMchId: '1234567890',
    bindStatus: 'pending',
    bindCheckedAt: null,
    bindFailReason: null,
    configuredAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = true;
    storesReadService.getBoundStoreRecordOrThrow.mockResolvedValue({ id: 9 });
    prisma.storeWechatPayConfig.findUnique.mockResolvedValue(storedConfig);
    prisma.storeWechatPayConfig.updateMany.mockResolvedValue({ count: 1 });
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'verified',
      code: 'ORDER_NOT_EXIST',
      message: '子商户绑定关系正常，可以正常收款',
    });
  });

  it('绑定关系正常时写回 verified 并清空失败原因', async () => {
    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('verified');
    const [args] = prisma.storeWechatPayConfig.updateMany.mock.calls[0];
    expect(args.data.bindStatus).toBe('verified');
    expect(args.data.bindFailReason).toBeNull();
  });

  it('状态回写必须带 subMchId 前置条件，避免旧号结论盖到新号上', async () => {
    await buildService().verifyAndPersist(user);

    const [args] = prisma.storeWechatPayConfig.updateMany.mock.calls[0];
    expect(args.where).toEqual({ storeId: 9, subMchId: '1234567890' });
  });

  it('未绑定时写回 failed 与中文失败原因', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'not_bound',
      code: 'NO_AUTH',
      message: '该子商户号尚未与本平台服务商绑定或未授权',
    });

    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('failed');
    const [args] = prisma.storeWechatPayConfig.updateMany.mock.calls[0];
    expect(args.data.bindStatus).toBe('failed');
    expect(args.data.bindFailReason).toContain('未授权');
  });

  // AppID 未关联与子商户未绑定同为「配置缺一环」，必须落到 failed，
  // 否则商家端会显示「待校验」而反复重试，实际永远收不到钱。
  it('AppID 未关联到子商户号时写回 failed 与对应原因', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'appid_not_bound',
      code: 'APPID_MCHID_NOT_MATCH',
      message:
        '该商户号尚未关联小程序的支付 AppID，请联系平台在微信支付服务商后台为商户号关联小程序后再校验',
    });

    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('failed');
    const [args] = prisma.storeWechatPayConfig.updateMany.mock.calls[0];
    expect(args.data.bindStatus).toBe('failed');
    expect(args.data.bindFailReason).toContain('AppID');
  });

  it('结果未知时保持 pending，不允许误判为可用', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'unknown',
      code: 'SYSTEM_ERROR',
      message: '暂时无法确认绑定关系',
    });

    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('pending');
    expect(
      prisma.storeWechatPayConfig.updateMany.mock.calls[0][0].data.bindStatus,
    ).toBe('pending');
  });

  it('查单期间子商户号被改动时丢弃校验结论，绝不写回 verified', async () => {
    // 回归 B3：并发改号后 updateMany 影响 0 行，必须判定被抢占
    prisma.storeWechatPayConfig.updateMany.mockResolvedValue({ count: 0 });

    await expect(buildService().verifyAndPersist(user)).rejects.toThrow(
      '子商户号在校验期间已变更，请重新发起绑定校验',
    );
    // 被抢占后不再读取「更新后的记录」，避免把旧结论回灌给新配置
    expect(prisma.storeWechatPayConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.storeWechatPayConfig.updateMany).toHaveBeenCalledTimes(1);
  });

  it('回写后记录已被删除时给出明确业务错误', async () => {
    prisma.storeWechatPayConfig.findUnique
      .mockResolvedValueOnce(storedConfig)
      .mockResolvedValueOnce(null);

    await expect(buildService().verifyAndPersist(user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('门店来自 JWT 上下文：不接受任何门店 ID 入参，无法校验他人配置', async () => {
    await buildService().verifyAndPersist(user);

    expect(storesReadService.getBoundStoreRecordOrThrow).toHaveBeenCalledWith(
      user,
    );
    expect(subMerchantVerifyService.checkBind).toHaveBeenCalledWith(
      storedConfig.subMchId,
    );
  });

  it('未保存子商户号时拒绝校验，不调用微信接口', async () => {
    prisma.storeWechatPayConfig.findUnique.mockResolvedValue(null);

    await expect(buildService().verifyAndPersist(user)).rejects.toThrow(
      BadRequestException,
    );
    expect(subMerchantVerifyService.checkBind).not.toHaveBeenCalled();
  });

  it('未开启服务商模式时拒绝校验', async () => {
    configState['wechat.partner.enabled'] = false;

    await expect(buildService().verifyAndPersist(user)).rejects.toThrow(
      BadRequestException,
    );
    expect(subMerchantVerifyService.checkBind).not.toHaveBeenCalled();
  });
});
