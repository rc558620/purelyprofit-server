// 录入订单详情组装服务：按扫码订单详情弹窗契约输出手工补录单
// 优先查 scan_orders（新链路：走状态机的手工单），回退 saleOrder（老数据）
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import { CommerceAccessService } from '../../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import type { ScanOrderingOrderDetailPayload } from '../scan-ordering.types';
import { fenToYuan } from '../../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';

/**
 * 录入订单详情服务：按扫码订单详情弹窗契约输出手工补录单。
 *
 * 优先查 scan_orders（新链路，走状态机），
 * 未命中则查 saleOrder（老链路，状态恒 completed）。
 */
@Injectable()
export class ManualEntryOrderDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按手工补录单 ID（scan_order.id / saleOrder.id）加载详情。 */
  async getDetail(
    user: AuthenticatedUser,
    entryId: number,
  ): Promise<ScanOrderingOrderDetailPayload> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看录入订单详情',
    );

    // 新链路：scan_orders 手工单（走状态机，展示真实状态与历史）
    const scanOrder = await (
      this.prisma.scanOrders.findFirst as (
        args: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | null>
    )({
      where: { id: entryId, storeId, manualEntry: true },
      select: {
        id: true,
        orderNo: true,
        status: true,
        version: true,
        createdAt: true,
        paidAmount: true,
        itemOriginalAmount: true,
        payableAmount: true,
        pickupNumber: true,
        table: { select: { name: true, tableCode: true } },
        items: {
          orderBy: { id: 'asc' as const },
          select: {
            productNameSnapshot: true,
            quantity: true,
            lineTotalAmount: true,
            payableLineAmount: true,
            specs: { select: { specOptionNameSnapshot: true } },
          },
        },
        histories: {
          orderBy: { createdAt: 'asc' as const },
          select: {
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (scanOrder) {
      const payableCents = scanOrder.payableAmount as number;
      const paidCents = scanOrder.paidAmount as number;
      const itemOrigCents = scanOrder.itemOriginalAmount as number;
      const totalYuan = fenToYuan(payableCents);
      const items = (scanOrder.items as Array<Record<string, unknown>>) ?? [];
      const histories =
        (scanOrder.histories as Array<Record<string, unknown>>) ?? [];
      const table = scanOrder.table as {
        name: string;
        tableCode: string;
      } | null;
      return {
        id: scanOrder.id as number,
        orderNo: scanOrder.orderNo as string,
        status:
          scanOrder.status as string as ScanOrderingOrderDetailPayload['status'],
        version: scanOrder.version as number,
        table: {
          name: table?.name ?? '-',
          tableCode: table?.tableCode ?? '-',
        },
        createdAt: (scanOrder.createdAt as Date).toISOString(),
        pickupNumber: scanOrder.pickupNumber as number | null,
        pickupNumberLabel:
          (scanOrder.pickupNumber as number | null) != null
            ? String(
                (scanOrder.pickupNumber as number) < 1000
                  ? String(scanOrder.pickupNumber).padStart(3, '0')
                  : String(scanOrder.pickupNumber),
              )
            : null,
        manualEntry: true,
        amountSummary: {
          itemOriginalAmount: fenToYuan(itemOrigCents),
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          serviceFeeAmount: 0,
          taxAmount: 0,
          payableAmount: totalYuan,
          paidAmount: fenToYuan(paidCents),
          outstandingAmount: 0,
          currency: 'CNY',
          pointsDeductAmount: 0,
          discountItems: [],
        },
        items: items.map((item: Record<string, unknown>) => {
          const itemSpecs =
            (item.specs as Array<Record<string, unknown>>) ?? [];
          return {
            name: item.productNameSnapshot as string,
            quantity: item.quantity as number,
            lineTotalAmount: fenToYuan(item.lineTotalAmount as number),
            amount: fenToYuan(item.payableLineAmount as number),
            specs: itemSpecs.map((s: Record<string, unknown>) => ({
              name: s.specOptionNameSnapshot as string,
              extraPrice: 0,
            })),
          };
        }),
        histories: histories.map((h: Record<string, unknown>) => ({
          fromStatus: String(h.fromStatus),
          toStatus: String(h.toStatus),
          reason: (h.reason as string) ?? '',
          createdAt: (h.createdAt as Date).toISOString(),
        })),
      };
    }

    // 老数据兜底：改造前已落 SaleOrder 的手工补录单
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where: { id: entryId, storeId, manualEntry: true },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        totalRevenue: true,
        diningTable: { select: { name: true, tableCode: true } },
        items: {
          orderBy: { id: 'asc' },
          select: {
            productName: true,
            salePrice: true,
            quantity: true,
          },
        },
      },
    });
    if (!saleOrder) throw new NotFoundException('录入订单不存在');

    const totalYuan = Money.fromDbCents(saleOrder.totalRevenue).toOutputYuan();
    return {
      id: saleOrder.id,
      orderNo: saleOrder.orderNo,
      status: 'completed',
      version: 0,
      table: {
        name: saleOrder.diningTable?.name ?? '-',
        tableCode: saleOrder.diningTable?.tableCode ?? '-',
      },
      createdAt: saleOrder.createdAt.toISOString(),
      pickupNumber: null,
      pickupNumberLabel: null,
      manualEntry: true,
      amountSummary: {
        itemOriginalAmount: totalYuan,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: 0,
        serviceFeeAmount: 0,
        taxAmount: 0,
        payableAmount: totalYuan,
        paidAmount: totalYuan,
        outstandingAmount: 0,
        currency: 'CNY',
        pointsDeductAmount: 0,
        discountItems: [],
      },
      items: saleOrder.items.map((item) => {
        const lineYuan = Money.fromDbCents(item.salePrice).toOutputYuan();
        return {
          name: item.productName,
          quantity: item.quantity,
          lineTotalAmount: lineYuan,
          amount: lineYuan,
          specs: [],
        };
      }),
      histories: [
        {
          fromStatus: 'completed',
          toStatus: 'completed',
          reason: '商家录入订单（手工补录）',
          createdAt: saleOrder.createdAt.toISOString(),
        },
      ],
    };
  }
}
