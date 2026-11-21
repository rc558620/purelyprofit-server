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
    enabled: true,
    printMessage: jest.fn(),
  };
  const user = { id: 1, name: '张三' } as AuthenticatedUser;

  const settings = {
    cashierPrintChannel: 'browser' as const,
    kitchenPrintChannel: 'cloud' as const,
    cashierCloudPrinterSn: null,
    kitchenCloudPrinterSn: 'KITCHEN-SN',
    cashierUsbPrinter: null,
    kitchenUsbPrinter: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    feiePrintService.enabled = true;
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
      createdAtLabel: '2026-08-17 15:45',
      pickupNumberLabel: '005',
      tableName: 'A01',
      remark: '不要辣',
      itemOriginalAmount: 50,
      specificationExtraAmount: 5,
      payableAmount: '37.00',
      discountAmount: 18,
      pointsDeductAmount: 2,
      discountItems: [
        { label: '会员等级折扣 8折', amount: -10, isStrikethrough: false },
        { label: '满50减8', amount: -8, isStrikethrough: false },
      ],
      items: [
        {
          name: '牛肉面',
          quantity: 2,
          unitPrice: 25,
          lineTotalAmount: 50,
          payableLineAmount: 40,
          specs: [{ name: '微辣' }],
        },
      ],
    });
  });

  it('后厨通道未配置云 SN 时抛 400（明确未送达，可重试）', async () => {
    await expect(
      service.printSnapshot({
        storeId: 11,
        settings: { ...settings, kitchenCloudPrinterSn: null },
        target: 'kitchen',
        orderId: 1,
        operatorName: '张三',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(feiePrintService.printMessage).not.toHaveBeenCalled();
  });

  it('飞鹅账号未配置时抛 400，且不占用自动打印名额', async () => {
    feiePrintService.enabled = false;

    await expect(
      service.printSnapshot({
        storeId: 11,
        settings,
        target: 'kitchen',
        orderId: 1,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(feiePrintService.printMessage).not.toHaveBeenCalled();
  });

  it('后厨云打印：组装制作单内容并下发飞鹅', async () => {
    feiePrintService.printMessage.mockResolvedValue('order-x');

    const result = await service.printSnapshot({
      storeId: 11,
      settings,
      target: 'kitchen',
      orderId: 1,
      operatorName: '张三',
    });

    expect(result).toBe('order-x');
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('后厨制作单'),
    );
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('牛肉面 x2'),
    );
    expect(feiePrintService.printMessage).toHaveBeenCalledWith(
      'KITCHEN-SN',
      expect.stringContaining('操作员：张三'),
    );
  });

  it('订单不存在时抛 404', async () => {
    printDataService.loadOrder.mockRejectedValue(
      new NotFoundException('扫码点餐订单不存在'),
    );
    await expect(
      service.printSnapshot({
        storeId: 11,
        settings,
        target: 'kitchen',
        orderId: 999,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('测试云打印：下发测试小票到目标打印机', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      ...settings,
      cashierPrintChannel: 'cloud',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: 'CASHIER-SN',
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
