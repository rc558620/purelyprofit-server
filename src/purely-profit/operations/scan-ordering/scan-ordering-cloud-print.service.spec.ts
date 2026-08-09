import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
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
  const printDataService = {
    loadOrder: jest.fn(),
  };
  const feiePrintService = {
    printMessage: jest.fn(),
  };
  const user = { id: 1, name: '张三' } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingCloudPrintService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: ScanOrderingPrintSettingsService,
          useValue: printSettingsService,
        },
        { provide: ScanOrderingPrintDataService, useValue: printDataService },
        { provide: FeiePrintService, useValue: feiePrintService },
      ],
    }).compile();
    service = module.get<ScanOrderingCloudPrintService>(
      ScanOrderingCloudPrintService,
    );
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(11);
    prismaService.store.findUnique.mockResolvedValue({ name: '测试门店' });
    printDataService.loadOrder.mockResolvedValue({
      orderNo: 'SO-001',
      pickupNumberLabel: '005',
      tableName: 'A01',
      remark: '不要辣',
      payableAmount: '40.00',
      items: [{ name: '牛肉面', quantity: 2, specs: [{ name: '微辣' }] }],
    });
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
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('操作员：张三'),
    );
  });

  it('订单不存在时抛 404', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'browser',
      kitchenPrintChannel: 'cloud',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: 'KITCHEN-SN',
    });
    printDataService.loadOrder.mockRejectedValue(
      new NotFoundException('扫码点餐订单不存在'),
    );
    await expect(
      service.printForMerchant(user, 'kitchen', 999),
    ).rejects.toThrow(NotFoundException);
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
