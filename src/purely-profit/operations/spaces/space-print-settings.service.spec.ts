import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('SpacePrintSettingsService', () => {
  let service: SpacePrintSettingsService;

  const prismaService = {
    store: { findUnique: jest.fn(), update: jest.fn() },
  };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(11),
  };

  /** 商家端用户（本文件只校验配置读写，权限解析由 commerceAccess 替身接管）。 */
  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.store.findUnique.mockResolvedValue({
      spacePrintChannel: 'browser',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: null,
    });
    prismaService.store.update.mockResolvedValue({ id: 11 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacePrintSettingsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();
    service = module.get<SpacePrintSettingsService>(SpacePrintSettingsService);
  });

  it('读取门店空间小票打印配置', async () => {
    await expect(service.getForMerchant(user)).resolves.toEqual({
      spacePrintChannel: 'browser',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: null,
    });
    expect(prismaService.store.findUnique).toHaveBeenCalledWith({
      where: { id: 11 },
      select: {
        spacePrintChannel: true,
        spaceCloudPrinterSn: true,
        spaceUsbPrinter: true,
      },
    });
  });

  it('空更新抛出 400：不让 Prisma 校验错误表现为 500', async () => {
    await expect(service.updateForMerchant(user, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaService.store.update).not.toHaveBeenCalled();
  });

  it('部分更新：只写入传入字段并回读最新配置', async () => {
    prismaService.store.findUnique.mockResolvedValue({
      spacePrintChannel: 'cloud',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: null,
    });
    await expect(
      service.updateForMerchant(user, { spacePrintChannel: 'cloud' }),
    ).resolves.toEqual({
      spacePrintChannel: 'cloud',
      spaceCloudPrinterSn: null,
      spaceUsbPrinter: null,
    });
    expect(prismaService.store.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { spacePrintChannel: 'cloud' },
    });
  });
});
