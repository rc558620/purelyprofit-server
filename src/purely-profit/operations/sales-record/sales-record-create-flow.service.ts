import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
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
                    take: 1,
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

      // 空间结账含抵扣项时 totalRevenue 可能为零或负数，
      // 此时不产生正向现金流记录（实际收款已在预付/续费时记录）。
      if (Money.fromInputYuan(params.totalRevenue).toDbCents() > 0) {
        await transaction.financeCashFlowRecord.create({
          data: {
            storeId: params.storeId,
            saleOrderId: createdOrder.id,
            operatorStaffId: params.operatorStaffId,
            direction: 'income',
            category: 'sales',
            title: `${createdOrder.orderNo} 销售收入`,
            amount: Money.fromInputYuan(params.totalRevenue).toDbCents(),
            payment: params.dto.paymentMethod,
            note: params.note,
            date: params.orderDate,
          },
        });
      }

      return createdOrder;
    };

    const created = params.options?.transactionClient
      ? await createRecordWithinTransaction(params.options.transactionClient)
      : await this.prisma.$transaction(createRecordWithinTransaction);

    return mapSalesRecordResponse(created);
  }
}
