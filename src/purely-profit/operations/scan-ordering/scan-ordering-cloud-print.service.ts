import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';
import { FeiePrintService } from './feie-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 云打印目标：收银台顾客票 / 后厨制作单。 */
export type CloudPrintTarget = 'cashier' | 'kitchen';

/**
 * 扫码点餐云打印下发服务（飞鹅通道）。
 * - 读门店打印配置，取对应目标的云打印机 SN
 * - 查订单数据组装飞鹅 content（<BR>、<CB>、<B> 等标签）
 * - 调 FeiePrintService 下发到云打印机
 */
@Injectable()
export class ScanOrderingCloudPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printSettingsService: ScanOrderingPrintSettingsService,
    private readonly printDataService: ScanOrderingPrintDataService,
    private readonly feiePrintService: FeiePrintService,
  ) {}

  /** 商家端下发云打印任务（按目标取对应打印机 SN）。 */
  async printForMerchant(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
    orderId: number,
  ): Promise<string> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const sn =
      target === 'kitchen'
        ? settings.kitchenCloudPrinterSn
        : settings.cashierCloudPrinterSn;
    if (!sn) {
      throw new BadRequestException(
        target === 'kitchen'
          ? '后厨打印未配置云打印机 SN，请先在打印设置中配置'
          : '收银台打印未配置云打印机 SN，请先在打印设置中配置',
      );
    }
    const operatorName = user.name ?? undefined;
    const content =
      target === 'kitchen'
        ? await this.buildKitchenTicketContent(storeId, orderId, operatorName)
        : await this.buildCashierReceiptContent(storeId, orderId, operatorName);
    return this.feiePrintService.printMessage(sn, content);
  }

  /** 测试云打印：按目标向对应云打印机下发测试内容。 */
  async testPrintForMerchant(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
  ): Promise<string> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const sn =
      target === 'kitchen'
        ? settings.kitchenCloudPrinterSn
        : settings.cashierCloudPrinterSn;
    if (!sn) {
      throw new BadRequestException(
        target === 'kitchen'
          ? '后厨打印未配置云打印机 SN，请先配置后再测试'
          : '收银台打印未配置云打印机 SN，请先配置后再测试',
      );
    }
    const title = target === 'kitchen' ? '后厨测试打印' : '收银台测试打印';
    const content = `<CB>${title}</CB><BR><BR>测试小票，验证云打印链路正常。<BR><BR>时间：${new Date().toLocaleString('zh-CN')}<BR><CUT>`;
    return this.feiePrintService.printMessage(sn, content);
  }

  /** 组装后厨制作单内容：桌台、取餐号、商品+规格+数量、备注、操作员。 */
  private async buildKitchenTicketContent(
    storeId: number,
    orderId: number,
    operatorName?: string,
  ): Promise<string> {
    const order = await this.printDataService.loadOrder(storeId, orderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const lines: string[] = [];
    lines.push(`<CB>${store?.name ?? '门店'}</CB><BR>`);
    lines.push('<CB>后厨制作单</CB><BR>');
    lines.push('<BR>');
    lines.push(`桌台：<B>${order.tableName}</B><BR>`);
    if (order.pickupNumberLabel) {
      lines.push(`取餐号：<B>${order.pickupNumberLabel}</B><BR>`);
    }
    lines.push(`订单号：${order.orderNo}<BR>`);
    if (operatorName) {
      lines.push(`操作员：${operatorName}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<B>商品明细</B><BR>');
    order.items.forEach((item) => {
      lines.push(`${item.name} ×${item.quantity}<BR>`);
      item.specs.forEach((spec) => {
        lines.push(`   ${spec.name}<BR>`);
      });
    });
    if (order.remark) {
      lines.push('<BR>');
      lines.push(`备注：${order.remark}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<CUT>');
    return lines.join('');
  }

  /** 组装收银台顾客票内容：门店、订单号、取餐号、桌台、商品、应付金额、操作员。 */
  private async buildCashierReceiptContent(
    storeId: number,
    orderId: number,
    operatorName?: string,
  ): Promise<string> {
    const order = await this.printDataService.loadOrder(storeId, orderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const lines: string[] = [];
    lines.push(`<CB>${store?.name ?? '门店'}</CB><BR>`);
    lines.push('<CB>扫码点餐订单</CB><BR>');
    lines.push('<BR>');
    lines.push(`订单号：${order.orderNo}<BR>`);
    if (order.pickupNumberLabel) {
      lines.push(`取餐号：<B>${order.pickupNumberLabel}</B><BR>`);
    }
    lines.push(`桌台：${order.tableName}<BR>`);
    if (operatorName) {
      lines.push(`操作员：${operatorName}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<B>商品明细</B><BR>');
    order.items.forEach((item) => {
      lines.push(`${item.name} ×${item.quantity}<BR>`);
      item.specs.forEach((spec) => {
        lines.push(`   ${spec.name}<BR>`);
      });
    });
    lines.push('<BR>');
    lines.push(`实付：<B>¥${order.payableAmount}</B><BR>`);
    if (order.remark) {
      lines.push(`备注：${order.remark}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<C>谢谢惠顾，欢迎再次光临</C><BR>');
    lines.push('<CUT>');
    return lines.join('');
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
