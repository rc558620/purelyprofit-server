import { Prisma, SpaceSessionStatus } from '@prisma/client';

export const SALE_ORDER_ITEM_SELECT = {
  id: true,
  productName: true,
  salePrice: true,
  quantity: true,
  product: {
    select: {
      stock: true,
      unit: true,
    },
  },
  order: {
    select: {
      id: true,
      date: true,
      paymentMethod: true,
      operatorNameSnapshot: true,
      operatorStaff: {
        select: {
          name: true,
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
      spaceSession: {
        select: {
          startTime: true,
          prepaidPaymentMethod: true,
          prepaidCustomerPaymentMethod: true,
          prepaidGrouponPlatform: true,
          prepaidGrouponCode: true,
          sessionRenewRecords: {
            select: {
              paymentMethod: true,
              amount: true,
              renewedAt: true,
              grouponPlatform: true,
              grouponCode: true,
            },
          },
          space: {
            select: {
              name: true,
            },
          },
          openOperatorNameSnapshot: true,
          openOperatorStaff: {
            select: {
              name: true,
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
      },
    },
  },
} satisfies Prisma.SaleOrderItemSelect;

export type ShiftRangeLike = {
  startAt: Date;
  endAt: Date;
};

/**
 * 构建 SaleOrder 查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 * 这样任何账号（主账号/店长/收银员）在班次期间创建的销售都能显示在
 * 对应班次的交班页面上，操作员名称由 saleOrder.operatorStaff 关联展示。
 */
export const buildSaleOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

/**
 * 构建 additionalRevenue 统计的 SaleOrder 查询条件：
 * 仅统计常规销售单（spaceSession IS NULL），按门店和时间范围过滤。
 * 空间会话结账订单的收入统一由 spaceRevenue 统计，不在此处重复计算。
 */
export const buildNonSpaceSessionOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return {
    storeId,
    date: dateFilter,
    spaceSession: { is: null },
  };
};

/**
 * 构建 SaleOrderItem 查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 */
export const buildSaleOrderItemOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderItemWhereInput['order'] => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

/**
 * 构建现金流水查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 */
export const buildCashFlowWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.FinanceCashFlowRecordWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

export const buildSpaceRefundOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => ({
  storeId,
  totalRevenue: {
    lt: 0,
  },
  spaceSession: {
    is: {
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
    },
  },
});
