import { BadRequestException } from '@nestjs/common';
import { ClubWechatSubMerchantVerifyService } from '../../purely-club/payments/club-wechat-sub-merchant-verify.service';
import { StoresWechatPayBindService } from './stores-wechat-pay-bind.service';

describe('StoresWechatPayBindService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.partner.enabled': true,
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };

  const prisma = {
    storeWechatPayConfig: { findUnique: jest.fn(), update: jest.fn() },
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
    prisma.storeWechatPayConfig.update.mockResolvedValue(storedConfig);
  });

  it('绑定关系正常时写回 verified 并清空失败原因', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'verified',
      code: 'ORDER_NOT_EXIST',
      message: '子商户绑定关系正常，可以正常收款',
    });

    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('verified');
    const [args] = prisma.storeWechatPayConfig.update.mock.calls[0];
    expect(args.where).toEqual({ storeId: 9 });
    expect(args.data.bindStatus).toBe('verified');
    expect(args.data.bindFailReason).toBeNull();
  });

  it('未绑定时写回 failed 与中文失败原因', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'not_bound',
      code: 'NO_AUTH',
      message: '该子商户号尚未与本平台服务商绑定或未授权',
    });

    const { outcome } = await buildService().verifyAndPersist(user);

    expect(outcome).toBe('failed');
    const [args] = prisma.storeWechatPayConfig.update.mock.calls[0];
    expect(args.data.bindStatus).toBe('failed');
    expect(args.data.bindFailReason).toContain('未授权');
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
      prisma.storeWechatPayConfig.update.mock.calls[0][0].data.bindStatus,
    ).toBe('pending');
  });

  it('门店来自 JWT 上下文：不接受任何门店 ID 入参，无法校验他人配置', async () => {
    subMerchantVerifyService.checkBind.mockResolvedValue({
      status: 'verified',
      code: 'ORDER_NOT_EXIST',
      message: '',
    });

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
