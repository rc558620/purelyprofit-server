import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import { SpacePrintDataService } from './space-print-data.service';
import { FeiePrintService } from '../scan-ordering/feie-print.service';
import { UsbPrintService } from '../scan-ordering/usb-print.service';
import { PrintAgentService } from '../scan-ordering/print-agent.service';
import { EscPosTicketBuilder } from '../scan-ordering/escpos-ticket.builder';
import type { SpaceEscPosTicket } from '../scan-ordering/escpos-ticket.builder';
import type { UsbPrinterInfo } from '../scan-ordering/usb-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/**
 * 空间消费小票下发服务（复用扫码点餐的打印通道基础设施）：
 * - cloud：读门店空间小票配置取云打印机 SN，组装飞鹅内容下发
 * - usb：组装 ESC/POS 字节流，已绑定打印代理则推送到门店代理，否则回退服务器本机 USB
 * 与扫码点餐打印完全隔离：各自独立的通道配置、内容组装与打印目标。
 */
@Injectable()
export class SpacePrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printSettingsService: SpacePrintSettingsService,
    private readonly printDataService: SpacePrintDataService,
    private readonly feiePrintService: FeiePrintService,
    private readonly usbPrintService: UsbPrintService,
    private readonly agentService: PrintAgentService,
    private readonly ticketBuilder: EscPosTicketBuilder,
  ) {}

  /** 商家端下发空间消费小票打印任务（按门店配置通道分派 cloud/usb）。 */
  async printForMerchant(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<{ orderId: string }> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = settings.spacePrintChannel;
    if (channel === 'cloud') {
      const orderId = await this.printCloud(storeId, saleOrderId);
      return { orderId };
    }
    if (channel === 'usb') {
      const orderId = await this.printUsb(user, storeId, saleOrderId);
      return { orderId };
    }
    throw new BadRequestException(
      '空间小票打印通道未启用云/USB 打印，请先在打印设置中配置',
    );
  }

  /** 商家端测试空间小票打印（按门店配置通道向目标打印机下发测试小票）。 */
  async testPrintForMerchant(
    user: AuthenticatedUser,
  ): Promise<{ orderId: string }> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = settings.spacePrintChannel;
    if (channel === 'cloud') {
      const sn = settings.spaceCloudPrinterSn;
      if (!sn) {
        throw new BadRequestException(
          '空间打印未配置云打印机 SN，请先配置后再测试',
        );
      }
      const content =
        '<CB>空间打印测试</CB><BR><BR>测试小票，验证云打印链路正常。<BR><BR>时间：' +
        `${new Date().toLocaleString('zh-CN')}<BR><CUT>`;
      const orderId = await this.feiePrintService.printMessage(sn, content);
      return { orderId };
    }
    if (channel === 'usb') {
      const printer = settings.spaceUsbPrinter;
      const data = this.ticketBuilder.buildTest('空间打印测试');
      if (await this.agentService.isAgentBound(storeId)) {
        const result = await this.agentService.dispatch(storeId, {
          taskId: PrintAgentService.newTaskId(),
          target: 'cashier',
          dataBase64: data.toString('base64'),
        });
        if (!result.ok) {
          throw new ServiceUnavailableException(result.message);
        }
        return { orderId: result.taskId };
      }
      const orderId = await this.usbPrintService.printRaw(
        data,
        printer ?? undefined,
      );
      return { orderId };
    }
    throw new BadRequestException(
      '空间小票打印通道未启用云/USB 打印，请先在打印设置中配置',
    );
  }

  /** 商家端探测可用打印机：门店已绑定打印代理时返回代理上报列表，否则服务器本机探测。 */
  async listUsbDevices(user: AuthenticatedUser): Promise<UsbPrinterInfo[]> {
    const storeId = await this.resolveMerchantStoreIdForView(user);
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

  /** 云打印：组装飞鹅标签内容并下发到配置的云打印机。 */
  private async printCloud(
    storeId: number,
    saleOrderId: number,
  ): Promise<string> {
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const sn = settings.spaceCloudPrinterSn;
    if (!sn) {
      throw new BadRequestException(
        '空间打印未配置云打印机 SN，请先在打印设置中配置',
      );
    }
    const order = await this.printDataService.loadOrder(storeId, saleOrderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const lines: string[] = [];
    lines.push(`<CB>${store?.name ?? '门店'}</CB><BR>`);
    lines.push('<C>消费小票</C><BR>');
    lines.push(`空间：${order.spaceName}<BR>`);
    if (order.guestName) {
      lines.push(`顾客：${order.guestName}<BR>`);
    }
    if (order.guestCount != null) {
      lines.push(`人数：${order.guestCount} 人<BR>`);
    }
    lines.push(`开台：${order.startTimeLabel}<BR>`);
    lines.push(`结账：${order.endTimeLabel}<BR>`);
    lines.push(`时长：${order.durationLabel}<BR>`);
    lines.push(`计费：${order.billingModeLabel}<BR>`);
    if (order.hourlyRate != null) {
      lines.push(`台位费单价：￥${order.hourlyRate.toFixed(2)}/小时<BR>`);
    }
    lines.push('--------------------------------<BR>');
    if (order.items.length > 0) {
      lines.push('商品明细<BR>');
      order.items.forEach((item) => {
        lines.push(
          `${item.name} x${item.quantity}  ￥${item.subtotal.toFixed(2)}<BR>`,
        );
      });
      lines.push(`商品合计：￥${order.itemsCost.toFixed(2)}<BR>`);
    }
    if (order.renewDeduction > 0) {
      lines.push(`续费抵扣：-￥${order.renewDeduction.toFixed(2)}<BR>`);
    }
    if (order.prepaidDeduction > 0) {
      lines.push(`预付抵扣：-￥${order.prepaidDeduction.toFixed(2)}<BR>`);
    }
    lines.push('--------------------------------<BR>');
    // 合计可能为负数（应退），与 USB 通道一致保持常规字重
    lines.push(`合计：￥${order.totalAmount.toFixed(2)}<BR>`);
    lines.push(`支付方式：${order.paymentMethodLabel}<BR>`);
    if (order.note) {
      lines.push(`备注：${order.note}<BR>`);
    }
    if (order.operatorName) {
      lines.push(`操作员：${order.operatorName}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<C>谢谢惠顾，欢迎再次光临</C><BR>');
    lines.push('<CUT>');
    return this.feiePrintService.printMessage(sn, lines.join(''));
  }

  /** USB 打印：组装 ESC/POS 字节流，代理推送优先，本机回退。 */
  private async printUsb(
    user: AuthenticatedUser,
    storeId: number,
    saleOrderId: number,
  ): Promise<string> {
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const order = await this.printDataService.loadOrder(storeId, saleOrderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const ticket: SpaceEscPosTicket = {
      storeName: store?.name ?? '',
      title: '消费小票',
      spaceName: order.spaceName,
      guestName: order.guestName,
      guestCount: order.guestCount,
      startTimeLabel: order.startTimeLabel,
      endTimeLabel: order.endTimeLabel,
      durationLabel: order.durationLabel,
      billingModeLabel: order.billingModeLabel,
      hourlyRate: order.hourlyRate,
      timeCost: order.timeCost,
      items: order.items,
      itemsCost: order.itemsCost,
      renewDeduction: order.renewDeduction,
      prepaidDeduction: order.prepaidDeduction,
      totalAmount: order.totalAmount,
      paymentMethodLabel: order.paymentMethodLabel,
      note: order.note,
      operatorName: order.operatorName ?? user.name ?? null,
      footer: '谢谢惠顾，欢迎再次光临',
    };
    const data = this.ticketBuilder.buildSpaceTicket(ticket);

    if (await this.agentService.isAgentBound(storeId)) {
      const result = await this.agentService.dispatch(storeId, {
        taskId: PrintAgentService.newTaskId(),
        target: 'cashier',
        dataBase64: data.toString('base64'),
      });
      if (!result.ok) {
        throw new ServiceUnavailableException(result.message);
      }
      return result.taskId;
    }
    return this.usbPrintService.printRaw(
      data,
      settings.spaceUsbPrinter ?? undefined,
    );
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权操作空间小票打印',
    );
  }

  private async resolveMerchantStoreIdForView(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看空间小票打印设备',
    );
  }
}
