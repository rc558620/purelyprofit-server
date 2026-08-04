import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { CreateSalesRecordDto } from '../../purely-profit/operations/sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../../purely-profit/operations/sales-record/sales-record.service';
import { Money } from '../../shared/money.utils';

const createScanOrderingSystemUser = (): AuthenticatedUser => ({
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
    paymentMethod: 'wechat' | 'other',
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

    await this.salesRecordService.create(
      createScanOrderingSystemUser(),
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
    paymentMethod: 'wechat' | 'other',
  ): CreateSalesRecordDto {
    return {
      storeId: order.storeId,
      paymentMethod,
      calcMode: 'business',
      date: (order.paidAt ?? new Date()).getTime(),
      note: `扫码点餐订单 ${order.orderNo}${order.remark ? `：${order.remark}` : ''}`,
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
