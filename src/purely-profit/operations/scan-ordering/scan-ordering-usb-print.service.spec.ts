import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { EscPosTicketBuilder } from './escpos-ticket.builder';
import { UsbPrintService } from './usb-print.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingUsbPrintService', () => {
  let service: ScanOrderingUsbPrintService;

  const prismaService = { store: { findUnique: jest.fn() } };
  const commerceAccessService = { resolveSingleStoreId: jest.fn() };
  const printSettingsService = { getByStoreId: jest.fn() };
  const printDataService = { loadOrder: jest.fn() };
  const usbPrintService = { printRaw: jest.fn(), listDevices: jest.fn() };
  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingUsbPrintService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: ScanOrderingPrintSettingsService,
          useValue: printSettingsService,
        },
        { provide: ScanOrderingPrintDataService, useValue: printDataService },
        { provide: UsbPrintService, useValue: usbPrintService },
        {
          provide: EscPosTicketBuilder,
          useValue: new EscPosTicketBuilder('utf8'),
        },
      ],
    }).compile();
    service = module.get<ScanOrderingUsbPrintService>(
      ScanOrderingUsbPrintService,
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

  it('后厨 USB 打印：使用后厨打印机并下发制作单字节流', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'browser',
      kitchenPrintChannel: 'usb',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
      cashierUsbPrinter: null,
      kitchenUsbPrinter: 'Kitchen80',
    });
    usbPrintService.printRaw.mockResolvedValue('Kitchen80');

    const result = await service.printForMerchant(user, 'kitchen', 1);

    expect(result).toBe('Kitchen80');
    expect(usbPrintService.printRaw).toHaveBeenCalledTimes(1);
    const [data, device] = usbPrintService.printRaw.mock.calls[0];
    expect(device).toBe('Kitchen80');
    expect(data).toBeInstanceOf(Buffer);
    const text = data.toString('utf8');
    expect(text).toContain('后厨制作单');
    expect(text).toContain('牛肉面 ×2');
    expect(text).not.toContain('应付');
  });

  it('收银台 USB 打印：未配置打印机时由硬件层自动探测，含应付金额', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'usb',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
      cashierUsbPrinter: null,
      kitchenUsbPrinter: null,
    });
    usbPrintService.printRaw.mockResolvedValue('/dev/usb/lp0');

    const result = await service.printForMerchant(user, 'cashier', 1);

    expect(result).toBe('/dev/usb/lp0');
    const [data, device] = usbPrintService.printRaw.mock.calls[0];
    expect(device).toBeUndefined();
    const text = data.toString('utf8');
    expect(text).toContain('扫码点餐订单');
    expect(text).toContain('应付：¥40.00');
    expect(text).toContain('谢谢惠顾，欢迎再次光临');
  });

  it('测试 USB 打印：下发测试小票到目标打印机', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'usb',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
      cashierUsbPrinter: 'CASHIER-USB',
      kitchenUsbPrinter: null,
    });
    usbPrintService.printRaw.mockResolvedValue('CASHIER-USB');

    const result = await service.testPrintForMerchant(user, 'cashier');

    expect(result).toBe('CASHIER-USB');
    expect(usbPrintService.printRaw.mock.calls[0][1]).toBe('CASHIER-USB');
    expect(
      usbPrintService.printRaw.mock.calls[0][0].toString('utf8'),
    ).toContain('收银台测试打印');
  });

  it('listUsbDevices 校验权限后透传硬件层探测结果', async () => {
    usbPrintService.listDevices.mockResolvedValue([
      { id: '/dev/usb/lp0', name: 'lp0', type: 'device' },
    ]);
    const devices = await service.listUsbDevices(user);
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('/dev/usb/lp0');
    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalled();
  });
});
