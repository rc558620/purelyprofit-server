import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ScanOrderingPrintSettings } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { EscPosTicketBuilder } from './escpos-ticket.builder';
import { UsbPrintService } from './usb-print.service';
import type { UsbPrinterInfo } from './usb-print.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/**
 * 扫码点餐 USB 打印下发服务（服务器本地 USB / 系统打印机通道）。
 * - 读门店打印配置，取对应目标的 USB 打印机标识（设备路径或 CUPS 打印机名）
 * - 查订单数据组装 ESC/POS 字节流
 * - 调 UsbPrintService 写入本地打印机
 */
@Injectable()
export class ScanOrderingUsbPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printSettingsService: ScanOrderingPrintSettingsService,
    private readonly printDataService: ScanOrderingPrintDataService,
    private readonly usbPrintService: UsbPrintService,
    private readonly ticketBuilder: EscPosTicketBuilder,
  ) {}

  /** 商家端下发 USB 打印任务（按目标取对应打印机标识）。 */
  async printForMerchant(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
    orderId: number,
  ): Promise<string> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const printer = this.resolvePrinter(settings, target);
    const order = await this.printDataService.loadOrder(storeId, orderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });

    const ticket = {
      storeName: store?.name ?? '',
      title: target === 'kitchen' ? '后厨制作单' : '扫码点餐订单',
      orderNo: order.orderNo,
      pickupNumberLabel: order.pickupNumberLabel,
      tableName: order.tableName,
      items: order.items,
      payableAmount: target === 'kitchen' ? null : order.payableAmount,
      remark: order.remark,
      footer: target === 'kitchen' ? null : '谢谢惠顾，欢迎再次光临',
    };
    const data = this.ticketBuilder.buildTicket(ticket);
    return this.usbPrintService.printRaw(data, printer ?? undefined);
  }

  /** 测试 USB 打印：按目标向对应打印机下发测试小票。 */
  async testPrintForMerchant(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
  ): Promise<string> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const printer = this.resolvePrinter(settings, target);
    const title = target === 'kitchen' ? '后厨测试打印' : '收银台测试打印';
    const data = this.ticketBuilder.buildTest(title);
    return this.usbPrintService.printRaw(data, printer ?? undefined);
  }

  /** 商家端探测服务器可用 USB / 系统小票打印机。 */
  async listUsbDevices(user: AuthenticatedUser): Promise<UsbPrinterInfo[]> {
    await this.resolveMerchantStoreId(user);
    return this.usbPrintService.listDevices();
  }

  /** 按打印目标取门店配置的 USB 打印机标识（未配置时返回 null，由硬件层自动探测）。 */
  private resolvePrinter(
    settings: ScanOrderingPrintSettings,
    target: CloudPrintTarget,
  ): string | null {
    return target === 'kitchen'
      ? settings.kitchenUsbPrinter
      : settings.cashierUsbPrinter;
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权操作扫码点餐打印',
    );
  }
}
