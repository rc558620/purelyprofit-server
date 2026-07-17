import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { isSpaceSessionDeductionProductId } from './space-session-settlement.shared';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import type { SpaceSessionItemRecord } from './space-sessions.types';

export interface CreateSessionSaleOrderParams {
  transaction: Prisma.TransactionClient;
  storeId: number;
  checkoutAt: number;
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  items: SpaceSessionItemRecord[];
  totalRevenue: number;
  totalProfit: number;
  totalQuantity: number;
  // ─── 团购 / 券 / 平台结算元数据 ─────────────────────────────
  customerPaymentMethod?: string;
  grouponCode?: string;
  grouponPlatform?: string;
  settlementChannel?: string;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number;
  settlementStatus?: string;
  platformReceivable?: number;
  platformSettledAmount?: number;
  platformFee?: number;
}

@Injectable()
export class SpaceSessionSaleOrderService {
  constructor(private readonly salesRecordService: SalesRecordService) {}

  async create(
    user: AuthenticatedUser,
    params: CreateSessionSaleOrderParams,
  ): Promise<SalesRecordResponseDto> {
    const dto: CreateSalesRecordDto = {
      storeId: params.storeId,
      // BUG-7 fix: 统一使用 productId 判定抵扣项，与 settlement.shared 口径一致
      items: params.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: isSpaceSessionDeductionProductId(item.productId)
          ? Math.abs(item.salePrice)
          : item.salePrice,
        profit: isSpaceSessionDeductionProductId(item.productId)
          ? Math.abs(item.profit)
          : item.profit,
        quantity: item.quantity,
      })),
      paymentMethod: params.paymentMethod,
      calcMode: 'business',
      ...(params.note ? { note: params.note } : {}),
      date: params.checkoutAt,
      // ─── 团购 / 券 / 平台结算元数据透传 ─────────────────────────
      ...(params.customerPaymentMethod !== undefined
        ? { customerPaymentMethod: params.customerPaymentMethod }
        : {}),
      ...(params.grouponCode !== undefined
        ? { grouponCode: params.grouponCode }
        : {}),
      ...(params.grouponPlatform !== undefined
        ? { grouponPlatform: params.grouponPlatform }
        : {}),
      ...(params.settlementChannel !== undefined
        ? { settlementChannel: params.settlementChannel }
        : {}),
      ...(params.voucherCode !== undefined
        ? { voucherCode: params.voucherCode }
        : {}),
      ...(params.voucherPlatform !== undefined
        ? { voucherPlatform: params.voucherPlatform }
        : {}),
      ...(params.voucherFaceAmount !== undefined
        ? { voucherFaceAmount: params.voucherFaceAmount }
        : {}),
      ...(params.settlementStatus !== undefined
        ? { settlementStatus: params.settlementStatus }
        : {}),
      ...(params.platformReceivable !== undefined
        ? { platformReceivable: params.platformReceivable }
        : {}),
      ...(params.platformSettledAmount !== undefined
        ? { platformSettledAmount: params.platformSettledAmount }
        : {}),
      ...(params.platformFee !== undefined
        ? { platformFee: params.platformFee }
        : {}),
    };

    return this.salesRecordService.create(user, dto, {
      // 追加点单时 session.items 已经扣过库存，结账只生成销售单，不再重复校验/扣减。
      skipInventoryValidationAndDeduction: true,
      // 结账权限已在 checkout service 层以 operation-entry:create 完成验证，无需再检查 sales:create。
      skipAccessCheck: true,
      // 主账号/店长代客结账时，应优先归属到当前待交班班次员工，避免逾期未交班后账目落到下一班。
      assignToCurrentShiftOperator: true,
      // 会话中的商品价格可能与当前目录价格不一致（如开台后调价），应使用会话记录的价格。
      preserveCallerPrices: true,
      transactionClient: params.transaction,
      // 抵扣项在 items 中以正数存储（代表已收到的预付款/续费），
      // 但 SaleOrder.totalRevenue 必须反映实际结算金额（消费 - 抵扣，可能为负数），
      // 因此使用结算层计算的权威值覆盖聚合结果。
      totalRevenueOverride: params.totalRevenue,
      totalProfitOverride: params.totalProfit,
    });
  }
}
