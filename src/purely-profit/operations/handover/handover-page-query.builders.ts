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
      // 手工补录单（录入单子）标识：交班明细按整单合并展示（与退款行组成 2 行）
      manualEntry: true,
      // 手工补录单就餐方式：商品名前缀区分堂食/外卖
      diningMode: true,
      // 手工补录单来源渠道：交班明细支付列展示具体来源（如美团团购）
      sourceChannel: true,
      // 团购券码：录入单子平台结算时填写，交班明细团购券码列展示
      grouponCode: true,
      operatorNameSnapshot: true,
      // 扫码点餐订单（purelyClub 下单）：携带桌台号、折扣信息与商品规格用于聚合
      scanOrder: {
        select: {
          productDiscountAmount: true,
          orderDiscountAmount: true,
          table: {
            select: {
              tableCode: true,
            },
          },
          // 扫码订单商品规格快照：用于同一订单内按商品+规格聚合后计算
          items: {
            select: {
              productNameSnapshot: true,
              quantity: true,
              specs: {
                select: { specOptionNameSnapshot: true },
                orderBy: { id: 'asc' },
              },
            },
            orderBy: { id: 'asc' },
          },
        },
      },
      operatorStaff: {
        select: {
          name: true,
          role: true,
          userId: true,
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
              userId: true,
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
 * 仅统计常规销售单（spaceSession IS NULL 且非扫码点餐订单），按门店和时间范围过滤。
 * 空间会话结账订单的收入统一由 spaceRevenue 统计，不在此处重复计算。
 * 扫码点餐订单（scanOrderId 非空，purelyClub 下单）收入统一归入 spaceRevenue（扫码点餐指标），
 * 避免餐饮账号下“营业收入”重复包含扫码点餐金额。
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
    scanOrderId: null,
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
