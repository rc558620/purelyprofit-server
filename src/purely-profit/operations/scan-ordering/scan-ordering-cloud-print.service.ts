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

  /** 组装后厨制作单内容：门店/标题/桌台/取餐号/订单号/下单时间/商品表头/商品+规格/操作员/备注（对齐浏览器预览）。 */
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
    // 标题：不加粗、常规字号（与顾客票一致，标题后不留空行）
    lines.push('<C>后厨制作单</C><BR>');
    lines.push(`订单号：${order.orderNo}<BR>`);
    if (order.pickupNumberLabel) {
      lines.push(`取餐号：${order.pickupNumberLabel}<BR>`);
    }
    lines.push(`桌台：${order.tableName}<BR>`);
    if (order.createdAtLabel) {
      lines.push(`下单时间：${order.createdAtLabel}<BR>`);
    }
    lines.push('--------------------------------<BR>');
    lines.push('商品明细<BR>');
    order.items.forEach((item) => {
      lines.push(`${item.name} x${item.quantity}<BR>`);
      if (item.specs.length > 0) {
        // 同一商品的多个规格用顿号合并展示
        lines.push(`  ${item.specs.map((spec) => spec.name).join('、')}<BR>`);
      }
    });
    // 后厨单：备注 → 操作员（备注上下带边框线）
    if (order.remark) {
      lines.push('--------------------------------<BR>');
      lines.push(`备注：${order.remark}<BR>`);
      lines.push('--------------------------------<BR>');
    }
    if (operatorName) {
      lines.push(`操作员：${operatorName}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<CUT>');
    return lines.join('');
  }

  /** 组装收银台顾客票内容：门店/标题/订单号/取餐号/桌台/下单时间/商品表头/商品+规格/备注/优惠清单/已优惠/实付/操作员/页脚（对齐浏览器预览）。 */
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
    // 标题：不加粗、常规字号（门店名与标题间不留空行，压缩顶部间距）
    lines.push('<C>扫码点餐订单</C><BR>');
    lines.push(`订单号：${order.orderNo}<BR>`);
    if (order.pickupNumberLabel) {
      lines.push(`取餐号：${order.pickupNumberLabel}<BR>`);
    }
    lines.push(`桌台：${order.tableName}<BR>`);
    if (order.createdAtLabel) {
      lines.push(`下单时间：${order.createdAtLabel}<BR>`);
    }
    lines.push('--------------------------------<BR>');
    lines.push('商品明细<BR>');
    order.items.forEach((item) => {
      const displayAmount = item.lineTotalAmount ?? item.payableLineAmount;
      const priceText = `  ￥${displayAmount.toFixed(2)}`;
      lines.push(`${item.name} x${item.quantity}${priceText}<BR>`);
      if (item.specs.length > 0) {
        // 同一商品的多个规格用顿号合并展示
        lines.push(`  ${item.specs.map((spec) => spec.name).join('、')}<BR>`);
      }
    });
    // 备注保持原位（商品明细后），顶部加边框线
    if (order.remark) {
      lines.push('--------------------------------<BR>');
      lines.push(`备注：${order.remark}<BR>`);
    }
    lines.push('--------------------------------<BR>');
    if (order.discountItems.length > 0 || order.pointsDeductAmount > 0) {
      lines.push('优惠清单<BR>');
      order.discountItems.forEach((discount) => {
        // 被覆盖/失效优惠（预览划线项）不打印
        if (discount.isStrikethrough) return;
        lines.push(
          `${discount.label}  -￥${Math.abs(discount.amount).toFixed(2)}<BR>`,
        );
      });
      if (order.pointsDeductAmount > 0) {
        lines.push(`积分抵扣  -￥${order.pointsDeductAmount.toFixed(2)}<BR>`);
      }
      lines.push('--------------------------------<BR>');
    }
    if (order.discountAmount > 0) {
      // 全角 ￥：半角 ¥（U+00A5）在飞鹅云端转码会丢失，导致票面看不到货币符号
      lines.push(`已优惠：￥${order.discountAmount.toFixed(2)} 元<BR>`);
    }
    lines.push(`实付：￥${order.payableAmount}<BR>`);
    if (operatorName) {
      lines.push(`操作员：${operatorName}<BR>`);
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
