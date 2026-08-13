import { Injectable } from '@nestjs/common';
import { Prisma, type FinanceCashFlowPayment } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { isDeductionItem } from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import {
  mapSalesRecordResponse,
  type SaleOrderWithItems,
} from './sales-record.domain';
import { generateOrderNo } from './sales-record.query';
import type {
  CreateSalesRecordOptions,
  PreparedSalesItem,
} from './sales-record-item-preparation.service';

/**
 * 将团购平台名称/枚举值映射到 FinanceCashFlowPayment 枚举值。
 * meituan/美团→meituan，douyin/抖音→douyin，其他平台或未知→platform。
 */
function resolveGrouponCashFlowPayment(
  grouponPlatform: string | undefined,
): string {
  if (!grouponPlatform) return 'platform';
  const normalized = grouponPlatform.trim().toLowerCase();
  if (normalized === 'meituan' || normalized.includes('美团')) return 'meituan';
  if (normalized === 'douyin' || normalized.includes('抖音')) return 'douyin';
  return 'platform';
}

@Injectable()
export class SalesRecordCreateFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async createRecord(params: {
    storeId: number;
    operatorStaffId: number | null;
    operatorNameSnapshot?: string | null;
    dto: CreateSalesRecordDto;
    preparedItems: PreparedSalesItem[];
    totalRevenue: number;
    totalProfit: number;
    totalQuantity: number;
    note: string | null;
    orderDate: Date;
    options?: CreateSalesRecordOptions;
  }): Promise<SalesRecordResponseDto> {
    const createRecordWithinTransaction = async (
      transaction: Prisma.TransactionClient,
    ): Promise<SaleOrderWithItems> => {
      const orderNo = await generateOrderNo(
        transaction,
        params.storeId,
        params.orderDate,
      );
      const createdOrder = await transaction.saleOrder.create({
        data: {
          storeId: params.storeId,
          operatorStaffId: params.operatorStaffId,
          operatorNameSnapshot: params.operatorNameSnapshot ?? null,
          orderNo,
          totalRevenue: Money.fromInputYuan(params.totalRevenue).toDbCents(),
          totalProfit: Money.fromInputYuan(params.totalProfit).toDbCents(),
          totalQuantity: params.totalQuantity,
          paymentMethod: params.dto.paymentMethod,
          calcMode: params.dto.calcMode,
          note: params.note,
          date: params.orderDate,
          ...(params.options?.scanOrderId !== undefined
            ? { scanOrderId: params.options.scanOrderId }
            : {}),
          // ─── 团购 / 券 / 平台结算元数据 ─────────────────────────────
          ...(params.dto.customerPaymentMethod !== undefined
            ? { customerPaymentMethod: params.dto.customerPaymentMethod }
            : {}),
          ...(params.dto.grouponCode !== undefined
            ? { grouponCode: params.dto.grouponCode }
            : {}),
          ...(params.dto.grouponPlatform !== undefined
            ? { grouponPlatform: params.dto.grouponPlatform }
            : {}),
          ...(params.dto.settlementChannel !== undefined
            ? { settlementChannel: params.dto.settlementChannel }
            : {}),
          ...(params.dto.voucherCode !== undefined
            ? { voucherCode: params.dto.voucherCode }
            : {}),
          ...(params.dto.voucherPlatform !== undefined
            ? { voucherPlatform: params.dto.voucherPlatform }
            : {}),
          ...(params.dto.voucherFaceAmount !== undefined
            ? {
                voucherFaceAmount: Money.fromInputYuan(
                  params.dto.voucherFaceAmount,
                ).toDbCents(),
              }
            : {}),
          ...(params.dto.settlementStatus !== undefined
            ? { grouponSettlementStatus: params.dto.settlementStatus }
            : {}),
          ...(params.dto.platformReceivable !== undefined
            ? {
                grouponPlatformReceivable: Money.fromInputYuan(
                  params.dto.platformReceivable,
                ).toDbCents(),
              }
            : {}),
          ...(params.dto.platformSettledAmount !== undefined
            ? {
                grouponPlatformSettledAmount: Money.fromInputYuan(
                  params.dto.platformSettledAmount,
                ).toDbCents(),
              }
            : {}),
          ...(params.dto.platformFee !== undefined
            ? {
                grouponPlatformFee: Money.fromInputYuan(
                  params.dto.platformFee,
                ).toDbCents(),
              }
            : {}),
          items: {
            create: params.preparedItems.map((item) => ({
              storeId: params.storeId,
              productId: item.productId,
              productName: item.productName,
              categoryName: item.categoryName,
              salePrice: item.salePrice.toDbCents(),
              profit: item.profit.toDbCents(),
              quantity: item.quantity,
              image: item.image ?? null,
            })),
          },
        },
        select: {
          id: true,
          orderNo: true,
          note: true,
          paymentMethod: true,
          calcMode: true,
          operatorNameSnapshot: true,
          date: true,
          createdAt: true,
          scanOrderId: true,
          // ─── 团购 / 券 / 平台结算元数据 ───────────────────────────
          customerPaymentMethod: true,
          grouponCode: true,
          grouponPlatform: true,
          settlementChannel: true,
          voucherCode: true,
          voucherPlatform: true,
          voucherFaceAmount: true,
          grouponSettlementStatus: true,
          grouponPlatformReceivable: true,
          grouponPlatformSettledAmount: true,
          grouponPlatformFee: true,
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              categoryName: true,
              salePrice: true,
              profit: true,
              quantity: true,
            },
            orderBy: [{ id: 'asc' }],
          },
          spaceSession: {
            select: {
              space: {
                select: {
                  name: true,
                },
              },
            },
          },
          operatorStaff: {
            select: {
              role: true,
              employeeProfile: {
                select: {
                  subAccounts: {
                    select: { role: true },
                  },
                },
              },
            },
          },
        },
      });

      const stockItems = params.preparedItems
        .filter(
          (item): item is PreparedSalesItem & { productId: number } =>
            item.productId !== null,
        )
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }));

      if (
        stockItems.length > 0 &&
        !params.options?.skipInventoryValidationAndDeduction
      ) {
        await this.inventoryService.recordSaleDeduction(transaction, {
          storeId: params.storeId,
          saleOrderId: createdOrder.id,
          operatorStaffId: params.operatorStaffId,
          items: stockItems,
        });
      }

      // 计算商品消费总额（排除抵扣项：预付款、续费抵扣）。
      // 空间结账时抵扣项的 salePrice 已被 Math.abs() 转正，
      // 必须通过 productName 而非 salePrice 符号来排除。
      // P2b fix: 使用 systemProductId 优先判定抵扣项
      const grossConsumptionCents = params.preparedItems
        .filter((item) => !isDeductionItem(item))
        .reduce(
          (sum, item) => sum + item.salePrice.toDbCents() * item.quantity,
          0,
        );

      // 使用商品消费总额判断是否创建现金流水，
      // 而非净额 totalRevenue（可能因抵扣而为零）。
      if (grossConsumptionCents > 0) {
        // 团购券不在 FinanceCashFlowPayment 枚举内，
        // 映射到平台支付方式（meituan/douyin/platform）。
        const isGroupon =
          params.dto.paymentMethod === 'groupon_voucher' ||
          params.dto.customerPaymentMethod === 'groupon_voucher';
        const cashFlowPayment = (
          isGroupon
            ? resolveGrouponCashFlowPayment(params.dto.grouponPlatform)
            : params.dto.paymentMethod
        ) as FinanceCashFlowPayment;

        // 现金流水金额始终使用消费毛额（正数行之和），
        // 确保预付款抵扣场景下财务流水仍能反映实际消费。
        // 例如：消费 ¥44 + 预付款 -¥44 → 毛额 ¥44，净额 ¥0，
        // 现金流水记 ¥44（顾客实际支付了 ¥44）。
        await transaction.financeCashFlowRecord.create({
          data: {
            storeId: params.storeId,
            saleOrderId: createdOrder.id,
            operatorStaffId: params.operatorStaffId,
            direction: 'income',
            category: 'sales',
            title: `${createdOrder.orderNo} 销售收入`,
            amount: grossConsumptionCents,
            payment: cashFlowPayment,
            note: params.note,
            date: params.orderDate,
          },
        });
      }

      return {
        ...createdOrder,
        refund: null,
      };
    };

    const created = params.options?.transactionClient
      ? await createRecordWithinTransaction(params.options.transactionClient)
      : await this.prisma.$transaction(createRecordWithinTransaction);

    return mapSalesRecordResponse(created);
  }
}
