import { Prisma, SpaceSessionStatus } from '@prisma/client';

export const SALE_ORDER_ITEM_SELECT = {
  id: true,
  productName: true,
  salePrice: true,
  quantity: true,
  product: {
    select: {
      // 商品 ID：交班库存列按销售扣减流水（saleOrderId+productId）取销售时点库存
      id: true,
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
          // 开台预付款金额（分）：交班消费行（台位费/追加点单）支付方式归属计算依赖
          prepaidAmount: true,
          // 空间会话商品行规格（非扫码订单的规格来源）：与 saleOrderItem 行级一一对应
          sessionItems: {
            select: {
              productName: true,
              specNames: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
          sessionRenewRecords: {
            select: {
              paymentMethod: true,
              amount: true,
              renewedAt: true,
              grouponPlatform: true,
              grouponCode: true,
            },
            // 续费按到账顺序（id 升序）返回，保证支付方式归属计算稳定
            orderBy: { id: 'asc' },
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

/**
 * 支付方式汇总（mapPaymentItems / buildSpaceConsumptionPaymentIndex）专用 select。
 *
 * ─── 为什么与 SALE_ORDER_ITEM_SELECT 分开 ────────────────────────────
 * loadPaymentOrderItems 覆盖班次内【全部】订单明细（无 take、无 orderBy），
 * 行数随班次订单量线性增长；而它的唯一消费方是支付方式金额汇总，
 * 只需要金额 + 支付方式归属字段。复用全量 select 会为每一行额外拉取：
 * scanOrder.items.specs、operatorStaff→employeeProfile→subAccounts、
 * spaceSession.sessionItems / space / openOperatorStaff 等纯展示字段，
 * 单行 payload 与 join 数量都被放大数倍。
 *
 * ─── ⚠️ DO NOT 精简掉这些字段 ────────────────────────────────────────
 * 支付方式归属不是简单的 order.paymentMethod：空间会话消费行要按
 * 资金到账顺序（开台预付 → 续费 → 结账补收）冲抵后取覆盖该行的那一笔资金，
 * 因此 prepaid* 与 sessionRenewRecords 是必需字段（见 BUG-1/5/7 说明）。
 */
export const PAYMENT_ORDER_ITEM_SELECT = {
  id: true,
  productName: true,
  salePrice: true,
  quantity: true,
  order: {
    select: {
      id: true,
      paymentMethod: true,
      // 团购券码：结账补收资金走团购券时，券码随该笔资金归属到消费行
      grouponCode: true,
      // 仅需判断是否为扫码点餐订单（purelyClub 下单）：非 null 即归入团购桶
      scanOrder: {
        select: { id: true },
      },
      spaceSession: {
        select: {
          prepaidPaymentMethod: true,
          prepaidCustomerPaymentMethod: true,
          prepaidGrouponPlatform: true,
          prepaidGrouponCode: true,
          // 开台预付款金额（分）：消费行支付方式归属的资金池来源之一
          prepaidAmount: true,
          sessionRenewRecords: {
            select: {
              paymentMethod: true,
              amount: true,
              renewedAt: true,
              grouponPlatform: true,
              grouponCode: true,
            },
            // 续费按到账顺序（id 升序）返回，保证支付方式归属计算稳定
            orderBy: { id: 'asc' },
          },
        },
      },
    },
  },
} satisfies Prisma.SaleOrderItemSelect;

/** 支付方式汇总查询返回的行类型（slim select） */
export type PaymentOrderItemRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof PAYMENT_ORDER_ITEM_SELECT;
}>;

/**
 * 已结账空间会话查询字段（客人应付 / 退款展示项的数据源）。
 *
 * ─── ⚠️ DO NOT REMOVE sessionRenewRecords ──────────────────────────────
 * 历史背景：BUG-1/5/7 修复前，续费会回写 session.prepaidAmount，
 * 导致"开台预付"和"续费"两个资金池混在一起，产生重复抵扣。
 * 修复后 space-session-renew.service.ts 彻底移除了 prepaid* 回写，
 * 因此 session.prepaidAmount **仅包含开台预付款，不含续费金额**。
 * 退款 / 客人应付必须从 sessionRenewRecords 独立累加续费金额。
 */
export const SETTLED_SPACE_SESSION_SELECT = {
  id: true,
  timeCost: true,
  itemsCost: true,
  prepaidAmount: true,
  prepaidGrouponCode: true,
  prepaidCustomerPaymentMethod: true,
  prepaidGrouponPlatform: true,
  endTime: true,
  space: {
    select: {
      name: true,
    },
  },
  saleOrder: {
    select: {
      paymentMethod: true,
      // 团购券信息：结账选团购券时，客人应付/退款行展示对应平台与券码
      grouponCode: true,
      grouponPlatform: true,
      date: true,
      operatorNameSnapshot: true,
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
    },
  },
  // ─── ⚠️ DO NOT REMOVE：退款/应付计算依赖续费记录 ────────
  // prepaidAmount 不含续费金额，必须独立查询 sessionRenewRecords
  sessionRenewRecords: {
    select: {
      amount: true,
      paymentMethod: true,
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.SpaceSessionSelect;

/**
 * 扫码点餐退款明细（SaleOrderRefund）查询字段：
 * 交班明细中展示为负数退款行，items 取首条用于展示原商品名与实时库存。
 */
export const SALE_ORDER_REFUND_SELECT = {
  id: true,
  amount: true,
  paymentMethod: true,
  refundedAt: true,
  saleOrder: {
    select: {
      id: true,
      date: true,
      manualEntry: true,
      // 手工补录单就餐方式：退款行商品名前缀区分堂食/外卖
      diningMode: true,
      sourceChannel: true,
      operatorNameSnapshot: true,
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
      scanOrder: {
        select: {
          table: {
            select: {
              tableCode: true,
            },
          },
        },
      },
      items: {
        select: {
          productName: true,
          // 退款行需要展示退款后恢复的库存：关联商品实时库存
          product: {
            select: {
              stock: true,
              unit: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.SaleOrderRefundSelect;

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
