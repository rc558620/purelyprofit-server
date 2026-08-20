import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { CreateSalesRecordDto } from '../../purely-profit/operations/sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../../purely-profit/operations/sales-record/sales-record.service';
import type { SalesPaymentMethodValue } from '../../purely-profit/operations/sales-record/sales-record.types';
import { Money } from '../../shared/money.utils';

export const createScanOrderingSystemUser = (): AuthenticatedUser => ({
  id: 0,
  email: 'system@scan-ordering.local',
  phone: '',
  name: '扫码点餐系统',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastActiveAt: null,
  currentMembership: null,
});

interface PaidScanOrderItem {
  productNameSnapshot: string;
  categoryNameSnapshot: string | null;
  quantity: number;
  payableLineAmount: number;
  menuProduct: { productId: number | null };
}

interface ScanSaleUnit {
  productId: string | undefined;
  productName: string;
  categoryName: string;
  weight: number;
}

@Injectable()
export class ScanOrderingSaleOrderBridgeService {
  constructor(private readonly salesRecordService: SalesRecordService) {}

  async createForPaidOrder(
    transaction: Prisma.TransactionClient,
    orderId: number,
    paymentMethod: string,
    /** 实际操作员（出餐/拒绝的商家账号）；缺省时使用系统用户，销售单不记录操作员 */
    operator: AuthenticatedUser = createScanOrderingSystemUser(),
  ): Promise<void> {
    const existing = await transaction.saleOrder.findUnique({
      where: { scanOrderId: orderId },
      select: { id: true },
    });
    if (existing) return;

    const order = await transaction.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        storeId: true,
        orderNo: true,
        remark: true,
        paidAt: true,
        payableAmount: true,
        manualEntry: true,
        manualEntryMetadata: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            productNameSnapshot: true,
            categoryNameSnapshot: true,
            quantity: true,
            payableLineAmount: true,
            menuProduct: { select: { productId: true } },
          },
        },
      },
    });

    // 手工补录单：从 manualEntryMetadata 获取真实支付方式，并传入 manualEntry 选项
    if (order.manualEntry) {
      const meta = order.manualEntryMetadata as Record<string, unknown> | null;
      const manualPayment = (meta?.paymentMethod as string) ?? 'other';
      const diningMode =
        (meta?.diningMode as 'dineIn' | 'takeaway' | 'platform') ?? 'dineIn';
      const manualEntryOpt: NonNullable<
        Parameters<SalesRecordService['create']>[2]
      >['manualEntry'] = {
        diningMode,
      };
      if (meta?.sourceChannel)
        manualEntryOpt.sourceChannel =
          meta.sourceChannel as typeof manualEntryOpt.sourceChannel;
      if (meta?.externalOrderNo)
        manualEntryOpt.externalOrderNo = meta.externalOrderNo as string;
      // grouponCode 不在 manualEntry 元数据内，走下方 toCreateDto 的 DTO 字段落库
      if (meta?.guestCount !== undefined)
        manualEntryOpt.guestCount = meta.guestCount as number;
      if (meta?.customerPhone)
        manualEntryOpt.customerPhone = meta.customerPhone as string;
      await this.salesRecordService.create(
        operator,
        this.toCreateDto(
          order,
          manualPayment,
          meta?.grouponCode as string | undefined,
        ),
        {
          skipAccessCheck: true,
          skipInventoryValidationAndDeduction: true,
          preserveCallerSalePrices: true,
          transactionClient: transaction,
          scanOrderId: order.id,
          manualEntry: manualEntryOpt,
        },
      );
      return;
    }

    // 普通扫码订单：走既有逻辑
    await this.salesRecordService.create(
      operator,
      this.toCreateDto(order, paymentMethod),
      {
        skipAccessCheck: true,
        skipInventoryValidationAndDeduction: true,
        preserveCallerSalePrices: true,
        transactionClient: transaction,
        scanOrderId: order.id,
      },
    );
  }

  private toCreateDto(
    order: {
      storeId: number;
      orderNo: string;
      remark: string | null;
      paidAt: Date | null;
      payableAmount: number;
      items: PaidScanOrderItem[];
    },
    paymentMethod: string,
    grouponCode?: string,
  ): CreateSalesRecordDto {
    return {
      storeId: order.storeId,
      paymentMethod: paymentMethod as SalesPaymentMethodValue,
      calcMode: 'business',
      date: (order.paidAt ?? new Date()).getTime(),
      note: `扫码点餐订单 ${order.orderNo}${order.remark ? `：${order.remark}` : ''}`,
      ...(grouponCode ? { grouponCode } : {}),
      items: this.toPricedUnitItems(order.items, order.payableAmount).map(
        (item) => ({
          productId: item.productId,
          productName: item.productName,
          categoryName: item.categoryName,
          salePrice: Money.fromDbCents(item.salePrice).toOutputYuan(),
          profit: 0,
          quantity: 1,
        }),
      ),
    };
  }

  private toPricedUnitItems(
    items: PaidScanOrderItem[],
    payableAmount: number,
  ): Array<ScanSaleUnit & { salePrice: number }> {
    const units = items.flatMap((item) => this.toUnitItems(item));
    const totalWeight = units.reduce((sum, item) => sum + item.weight, 0);
    const allocationWeight = totalWeight > 0 ? totalWeight : units.length;
    let allocatedAmount = 0;

    return units.map((item, index) => {
      const weight = totalWeight > 0 ? item.weight : 1;
      const salePrice =
        index === units.length - 1
          ? payableAmount - allocatedAmount
          : Math.floor((payableAmount * weight) / allocationWeight);
      allocatedAmount += salePrice;
      return { ...item, salePrice };
    });
  }

  private toUnitItems(item: PaidScanOrderItem): ScanSaleUnit[] {
    const unitWeight = Math.floor(item.payableLineAmount / item.quantity);
    const remainder = item.payableLineAmount % item.quantity;

    return Array.from({ length: item.quantity }, (_, index) => ({
      productId: item.menuProduct.productId?.toString(),
      productName: item.productNameSnapshot,
      categoryName: item.categoryNameSnapshot ?? '扫码点餐',
      weight: unitWeight + (index < remainder ? 1 : 0),
    }));
  }
}
