import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { EscPosTicketBuilder } from './escpos-ticket.builder';
import { UsbPrintService } from './usb-print.service';
import { PrintAgentService } from './print-agent.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingUsbPrintService', () => {
  let service: ScanOrderingUsbPrintService;

  const prismaService = { store: { findUnique: jest.fn() } };
  const commerceAccessService = { resolveSingleStoreId: jest.fn() };
  const printSettingsService = { getByStoreId: jest.fn() };
  const printDataService = { loadOrder: jest.fn() };
  const usbPrintService = { printRaw: jest.fn(), listDevices: jest.fn() };
  const agentService = {
    isAgentBound: jest.fn(),
    dispatch: jest.fn(),
    getPrinters: jest.fn(),
  };
  const user = { id: 1, name: '张三' } as AuthenticatedUser;

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
        { provide: PrintAgentService, useValue: agentService },
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
    agentService.isAgentBound.mockResolvedValue(false);
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
    expect(text).toContain('操作员：张三');
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
    expect(text).toContain('实付：¥40.00');
    expect(text).toContain('操作员：张三');
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

  it('门店绑定代理后打印走代理推送（返回任务 ID，不调本机打印）', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'usb',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
      cashierUsbPrinter: null,
      kitchenUsbPrinter: null,
    });
    agentService.isAgentBound.mockResolvedValue(true);
    agentService.dispatch.mockResolvedValue({
      ok: true,
      taskId: 'task-123',
    });

    const result = await service.printForMerchant(user, 'cashier', 1);

    expect(result).toBe('task-123');
    expect(usbPrintService.printRaw).not.toHaveBeenCalled();
    const [storeId, task] = agentService.dispatch.mock.calls[0];
    expect(storeId).toBe(11);
    expect(task.target).toBe('cashier');
    expect(typeof task.dataBase64).toBe('string');
    // 字节流 Base64 解码后包含小票关键内容
    expect(Buffer.from(task.dataBase64, 'base64').toString('utf8')).toContain(
      '实付：¥40.00',
    );
  });

  it('门店绑定代理但代理离线时打印抛 503', async () => {
    printSettingsService.getByStoreId.mockResolvedValue({
      cashierPrintChannel: 'usb',
      kitchenPrintChannel: 'off',
      cashierCloudPrinterSn: null,
      kitchenCloudPrinterSn: null,
      cashierUsbPrinter: null,
      kitchenUsbPrinter: null,
    });
    agentService.isAgentBound.mockResolvedValue(true);
    agentService.dispatch.mockResolvedValue({
      ok: false,
      reason: 'agent-offline',
      message: '门店打印代理未在线',
    });

    await expect(service.printForMerchant(user, 'cashier', 1)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('门店绑定代理时 listUsbDevices 返回代理上报打印机列表', async () => {
    agentService.isAgentBound.mockResolvedValue(true);
    agentService.getPrinters.mockReturnValue([
      { id: 'RP58', name: 'RP58', type: 'windows' },
      { id: '/dev/usb/lp0', name: 'lp0', type: 'device' },
    ]);
    const devices = await service.listUsbDevices(user);
    expect(devices).toEqual([
      { id: 'RP58', name: 'RP58', type: 'cups' },
      { id: '/dev/usb/lp0', name: 'lp0', type: 'device' },
    ]);
    expect(usbPrintService.listDevices).not.toHaveBeenCalled();
  });
});
