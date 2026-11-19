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

/** 补打去重窗口：30 秒内同一订单视为重复提交，直接复用已有任务。 */
const REPRINT_DEDUPE_WINDOW_MS = 30_000;

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
    // 一次读取配置并在整条链路内复用：避免出票期间改配置导致「选通道用旧值、
    // 取 SN/设备用新值」的混用，也省掉 cloud/usb 分支里的重复查询。
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = settings.spacePrintChannel;
    if (channel === 'cloud') {
      const orderId = await this.printCloud(storeId, saleOrderId, settings);
      return { orderId };
    }
    if (channel === 'usb') {
      const orderId = await this.printUsb(user, storeId, saleOrderId, settings);
      return { orderId };
    }
    throw new BadRequestException(
      '空间小票打印通道未启用云/USB 打印，请先在打印设置中配置',
    );
  }

  /**
   * 补打：按销售订单重新下发小票。
   * 同一订单在去重窗口内已有「已提交/已打印」任务时直接返回该任务，
   * 避免收银员连点造成重复出纸（失败任务不拦截，允许立即重试）。
   */
  async reprintForMerchant(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<{ orderId: string; status: string }> {
    const storeId = await this.resolveMerchantStoreId(user);
    // 先校验订单属于当前门店：跨店 saleOrderId 在这里直接 404
    await this.printDataService.loadOrder(storeId, saleOrderId);
    const recent = await this.agentService.findRecentActiveTask(
      storeId,
      saleOrderId,
      REPRINT_DEDUPE_WINDOW_MS,
    );
    if (recent) {
      return { orderId: saleOrderId.toString(), status: recent.status };
    }
    const result = await this.printForMerchant(user, saleOrderId);
    return { orderId: result.orderId, status: 'submitted' };
  }

  /** 查询某订单最近一次打印任务状态（收银端确认是否真的出纸）。 */
  async getPrintTaskStatus(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<{ taskId: string; status: string; error: string | null } | null> {
    const storeId = await this.resolveMerchantStoreIdForView(user);
    await this.printDataService.loadOrder(storeId, saleOrderId);
    return this.agentService.findLatestTask(storeId, saleOrderId);
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
        // target 沿用 cashier：Go 代理 resolvePrinter 只区分 kitchen，其余目标（含协议
        // 预留的 space）一律走门店「收银台」打印机，与空间小票落到同一台的预期一致。
        // deviceId 由代理按上报的设备列表选择具体打印机；旧代理忽略该字段时行为不变。
        const result = await this.agentService.dispatch(storeId, {
          taskId: PrintAgentService.newTaskId(),
          target: 'cashier',
          deviceId: settings.spaceUsbPrinter ?? undefined,
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
      const printers = await this.agentService.getPrinters(storeId);
      return printers.map((printer) => ({
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
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
  ): Promise<string> {
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
        // 自助下单商品：商品名后拼「 (自助)」标注（半角括号，热敏机 ASCII 字库最规整）
        const name =
          item.sourceType === 'member_self_order'
            ? `${item.name} (自助)`
            : item.name;
        lines.push(
          `${name} x${item.quantity}  ￥${item.subtotal.toFixed(2)}<BR>`,
        );
        // 规格另起一行（对齐餐饮扫码点餐小票口径）
        if (item.specNames && item.specNames.length > 0) {
          lines.push(`  ${item.specNames.join('、')}<BR>`);
        }
      });
      lines.push(`商品合计：￥${order.itemsCost.toFixed(2)}<BR>`);
    }
    // 台位费：不占商品明细行，作为「商品合计」下方的单列汇总行
    if (order.timeCost > 0) {
      lines.push(
        `台位费 (${order.timeFeeLabel})：￥${order.timeCost.toFixed(2)}<BR>`,
      );
    }
    // 券面消费行：券面已在 purelyClub 付过，与下方「预付抵扣」等额冲抵。
    // 两行必须成对出现，否则票面只剩单向抵扣，明细加总与合计对不上。
    if (order.voucherConsumption > 0) {
      lines.push(
        `券面消费 (团购券)：￥${order.voucherConsumption.toFixed(2)}<BR>`,
      );
    }
    if (order.renewDeduction > 0) {
      lines.push(`续费抵扣：-￥${order.renewDeduction.toFixed(2)}<BR>`);
    }
    if (order.prepaidDeduction > 0) {
      lines.push(`预付抵扣：-￥${order.prepaidDeduction.toFixed(2)}<BR>`);
    }
    if (order.selfOrderDeduction > 0) {
      lines.push(
        `自助下单 (已支付)：-￥${order.selfOrderDeduction.toFixed(2)}<BR>`,
      );
    }
    // 卡抵扣是「付款方式从现金换成卡权益」，营业额里台位费仍存在，故单列冲减
    if (order.cardDeduction > 0) {
      lines.push(`会员卡抵扣：-￥${order.cardDeduction.toFixed(2)}<BR>`);
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
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
  ): Promise<string> {
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
      timeFeeLabel: order.timeFeeLabel,
      items: order.items,
      itemsCost: order.itemsCost,
      renewDeduction: order.renewDeduction,
      prepaidDeduction: order.prepaidDeduction,
      selfOrderDeduction: order.selfOrderDeduction,
      cardDeduction: order.cardDeduction,
      voucherConsumption: order.voucherConsumption,
      totalAmount: order.totalAmount,
      paymentMethodLabel: order.paymentMethodLabel,
      note: order.note,
      operatorName: order.operatorName ?? user.name ?? null,
      footer: '谢谢惠顾，欢迎再次光临',
    };
    const data = this.ticketBuilder.buildSpaceTicket(ticket);

    if (await this.agentService.isAgentBound(storeId)) {
      // target 沿用 cashier：Go 代理 resolvePrinter 只区分 kitchen，其余目标（含协议
      // 预留的 space）一律走门店「收银台」打印机，与空间小票落到同一台的预期一致。
      // deviceId 让代理按门店选择落到具体打印机；旧代理忽略该字段时行为不变。
      const result = await this.agentService.dispatch(
        storeId,
        {
          taskId: PrintAgentService.newTaskId(),
          target: 'cashier',
          deviceId: settings.spaceUsbPrinter ?? undefined,
          dataBase64: data.toString('base64'),
        },
        { saleOrderId },
      );
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
