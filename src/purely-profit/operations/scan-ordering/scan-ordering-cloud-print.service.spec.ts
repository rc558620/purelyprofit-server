import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { FeiePrintService } from './feie-print.service';
import { ScanOrderingCloudPrintService } from './scan-ordering-cloud-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingCloudPrintService', () => {
  let service: ScanOrderingCloudPrintService;

  const prismaService = {
    store: { findUnique: jest.fn() },
    scanOrders: { findFirst: jest.fn() },
  };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };
  const printSettingsService = {
    getByStoreId: jest.fn(),
  };
  const feiePrintService = {
    printMessage: jest.fn(),
  };
  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingCloudPrintService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ScanOrderingPrintSettingsService, useValue: printSettingsService },
        { provide: FeiePrintService, useValue: feiePrintService },
      ],
    }).compile();
    service = module.get<ScanOrderingCloudPrintService>(ScanOrderingCloudPrintService);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(11);
    prismaService.store.findUnique.mockResolvedValue({ name: '测试门店' });
  });

  it('后厨通道未配置云 SN 时抛 400', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'browser',
      kitchenPrintChannel: 'cloud',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
    });
    await expect(service.printForMerchant(user, 'kitchen', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('后厨云打印：组装制作单内容并下发飞鹅', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'browser',
      kitchenPrintChannel: 'cloud',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: 'KITCHEN-SN',
    });
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1,
      orderNo: 'SO-001',
      pickupNumber: 5,
      remark: '不要辣',
      payableAmount: 4000,
      table: { name: 'A01' },
      items: [
        { productNameSnapshot: '牛肉面', quantity: 2, specs: [{ specOptionNameSnapshot: '微辣' }] },
      ],
    });
    feiePrintService.printMessage.mockResolvedValue('order-x');

    const result = await service.printForMerchant(user, 'kitchen', 1);

    expect(result).toBe('order-x');
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('后厨制作单'),
    );
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('牛肉面 ×2'),
    );
  });

  it('订单不存在时抛 404', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'browser',
      kitchenPrintChannel: 'cloud',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: 'KITCHEN-SN',
    });
    prismaService.scanOrders.findFirst.mockResolvedValue(null);
    await expect(service.printForMerchant(user, 'kitchen', 999)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('测试云打印：下发测试小票到目标打印机', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'cloud',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: 'CASHIER-SN',
      kitchenCloudPrinterSn: null,
    });
    feiePrintService.printMessage.mockResolvedValue('order-test');

    const result = await service.testPrintForMerchant(user, 'cashier');

    expect(result).toBe('order-test');
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'CASHIER-SN',
      expect.stringContaining('测试打印'),
    );
  });
});
