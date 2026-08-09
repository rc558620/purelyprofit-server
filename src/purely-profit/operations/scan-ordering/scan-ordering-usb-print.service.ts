import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ScanOrderingPrintSettings } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { EscPosTicketBuilder } from './escpos-ticket.builder';
import { UsbPrintService } from './usb-print.service';
import { PrintAgentService } from './print-agent.service';
import type { PrintAgentPrinter } from './print-agent.service';
import type { UsbPrinterInfo } from './usb-print.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/**
 * 扫码点餐 USB 打印下发服务：
 * - 门店已绑定打印代理（云端部署）→ 组装 ESC/POS 字节流并推送到门店在线代理打印
 * - 门店未绑定代理（本地部署）→ 回退服务器本机 USB / 系统打印机
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
    private readonly agentService: PrintAgentService,
  ) {}

  /** 商家端下发 USB 打印任务（代理推送优先，本机回退）。 */
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
      operatorName: user.name ?? null,
      remark: order.remark,
      footer: target === 'kitchen' ? null : '谢谢惠顾，欢迎再次光临',
    };
    const data = this.ticketBuilder.buildTicket(ticket);

    if (await this.agentService.isAgentBound(storeId)) {
      return this.dispatchToAgent(storeId, target, data);
    }
    return this.usbPrintService.printRaw(data, printer ?? undefined);
  }

  /** 测试 USB 打印：代理推送优先，本机回退。 */
  async testPrintForMerchant(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
  ): Promise<string> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const printer = this.resolvePrinter(settings, target);
    const title = target === 'kitchen' ? '后厨测试打印' : '收银台测试打印';
    const data = this.ticketBuilder.buildTest(title);

    if (await this.agentService.isAgentBound(storeId)) {
      return this.dispatchToAgent(storeId, target, data);
    }
    return this.usbPrintService.printRaw(data, printer ?? undefined);
  }

  /** 商家端探测可用打印机：门店已绑定代理时返回代理上报列表，否则本机探测。 */
  async listUsbDevices(user: AuthenticatedUser): Promise<UsbPrinterInfo[]> {
    const storeId = await this.resolveMerchantStoreId(user);
    if (await this.agentService.isAgentBound(storeId)) {
      // windows 打印机的 type 对前端归一为 cups（同为"系统打印机"语义）
      return this.agentService.getPrinters(storeId).map((printer) => ({
        id: printer.id,
        name: printer.name,
        type: printer.type === 'windows' ? 'cups' : printer.type,
      }));
    }
    return this.usbPrintService.listDevices();
  }

  /** 向门店在线代理推送打印任务。 */
  private async dispatchToAgent(
    storeId: number,
    target: CloudPrintTarget,
    data: Buffer,
  ): Promise<string> {
    const result = await this.agentService.dispatch(storeId, {
      taskId: PrintAgentService.newTaskId(),
      target,
      dataBase64: data.toString('base64'),
    });
    if (!result.ok) {
      throw new ServiceUnavailableException(result.message);
    }
    return result.taskId;
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

export type { PrintAgentPrinter };
