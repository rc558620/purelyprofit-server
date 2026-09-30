// 取出核验单测：覆盖 S8（未勾选核对一律拒绝）与 S9（阈值门店手机号后四位）
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CustodyPickupVerifyService } from './custody-pickup-verify.service';
import type { CustodyReadService } from './custody-read.service';
import type { CustodySettingsDto } from './dto/custody-response.dto';

const createService = (options: {
  verifyEnabled: boolean;
  threshold: number | null;
  productPrice?: number | null;
}) => {
  const getSettings = jest.fn().mockResolvedValue({
    pickupPhoneVerifyEnabled: options.verifyEnabled,
    pickupPhoneVerifyThreshold: options.threshold,
  } as CustodySettingsDto);
  const findFirst = jest
    .fn()
    .mockResolvedValue(
      options.productPrice === null || options.productPrice === undefined
        ? null
        : { price: options.productPrice },
    );
  const service = new CustodyPickupVerifyService(
    { product: { findFirst } } as unknown as PrismaService,
    { getSettings } as unknown as CustodyReadService,
  );
  return { service, getSettings, findFirst };
};

describe('CustodyPickupVerifyService.ensureIdentityChecked', () => {
  const { service } = createService({ verifyEnabled: false, threshold: null });

  it('未勾选或未传字段时拒绝核销', () => {
    expect(() => service.ensureIdentityChecked(undefined)).toThrow(
      BadRequestException,
    );
    expect(() => service.ensureIdentityChecked(false)).toThrow(
      BadRequestException,
    );
  });

  it('显式勾选为 true 时放行', () => {
    expect(() => service.ensureIdentityChecked(true)).not.toThrow();
  });
});

describe('CustodyPickupVerifyService.verifyPhoneSuffix', () => {
  it('门店未开启且无阈值时不触发核验，也不查商品', async () => {
    const { service, findFirst } = createService({
      verifyEnabled: false,
      threshold: null,
    });

    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', ''),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('门店开启时后四位正确返回门店强制核验原因', async () => {
    const { service } = createService({ verifyEnabled: true, threshold: null });

    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', '8000'),
    ).resolves.toBe('门店强制核验');
  });

  it('门店开启时后四位不符或缺失一律拒绝', async () => {
    const { service } = createService({ verifyEnabled: true, threshold: null });

    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', '8001'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', undefined),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', '80'),
    ).rejects.toThrow(BadRequestException);
  });

  it('会员手机号缺失时不允许用任意后四位蒙混', async () => {
    const { service } = createService({ verifyEnabled: true, threshold: null });

    await expect(
      service.verifyPhoneSuffix(7, 101, null, '8000'),
    ).rejects.toThrow(BadRequestException);
  });

  it('单价达到阈值时即使门店未开启也强制核验', async () => {
    const { service } = createService({
      verifyEnabled: false,
      threshold: 50000,
      productPrice: 60000,
    });

    await expect(
      service.verifyPhoneSuffix(7, 101, '13800008000', '8000'),
    ).resolves.toBe('单价达阈值');
  });

  it('单价低于阈值或商品不存在时不触发核验', async () => {
    const below = createService({
      verifyEnabled: false,
      threshold: 50000,
      productPrice: 10000,
    });
    await expect(
      below.service.verifyPhoneSuffix(7, 101, '13800008000', ''),
    ).resolves.toBeNull();

    const missing = createService({
      verifyEnabled: false,
      threshold: 50000,
      productPrice: null,
    });
    await expect(
      missing.service.verifyPhoneSuffix(7, 101, '13800008000', ''),
    ).resolves.toBeNull();
  });

  it('阈值配置存在但存单未关联商品时不触发核验', async () => {
    const { service, findFirst } = createService({
      verifyEnabled: false,
      threshold: 50000,
      productPrice: 60000,
    });

    await expect(
      service.verifyPhoneSuffix(7, null, '13800008000', ''),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('CustodyPickupVerifyService.resolvePhoneVerifyReason', () => {
  it('门店开启时返回门店强制核验原因（不比对后四位）', async () => {
    const { service } = createService({ verifyEnabled: true, threshold: null });

    await expect(service.resolvePhoneVerifyReason(7, 101)).resolves.toBe(
      '门店强制核验',
    );
  });

  it('门店开启且单价达阈值时优先返回阈值原因', async () => {
    const { service } = createService({
      verifyEnabled: true,
      threshold: 50000,
      productPrice: 60000,
    });

    await expect(service.resolvePhoneVerifyReason(7, 101)).resolves.toBe(
      '单价达阈值',
    );
  });

  it('门店未开启且未配阈值时返回 null 且不查商品', async () => {
    const { service, findFirst } = createService({
      verifyEnabled: false,
      threshold: null,
    });

    await expect(service.resolvePhoneVerifyReason(7, 101)).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('配了阈值但单价未达时不触发核验', async () => {
    const { service } = createService({
      verifyEnabled: false,
      threshold: 50000,
      productPrice: 10000,
    });

    await expect(service.resolvePhoneVerifyReason(7, 101)).resolves.toBeNull();
  });
});
