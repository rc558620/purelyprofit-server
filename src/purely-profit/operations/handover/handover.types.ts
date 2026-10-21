import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  StaffRole,
  StoreSubAccountRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { HandoverShiftInfoDto } from './dto/handover-page.dto';
import type { SaleStockSnapshotIndex } from './handover-stock-snapshot';

/** 已结账的空间会话行数据（客人应付 / 退款展示项的数据源） */
export type SettledSpaceSessionRow = {
  id: number;
  timeCost: number | null;
  itemsCost: number;
  prepaidAmount: number | null;
  prepaidGrouponCode: string | null;
  prepaidCustomerPaymentMethod: string | null;
  prepaidGrouponPlatform: string | null;
  endTime: Date | null;
  space: { name: string };
  saleOrder: {
    paymentMethod: SalesPaymentMethod;
    /** 团购券码：结账选团购券时展示 */
    grouponCode?: string | null;
    /** 团购平台：结账选团购券时展示（如 taobao/meituan） */
    grouponPlatform?: string | null;
    date: Date;
    operatorNameSnapshot: string | null;
    operatorStaff: {
      name: string;
      role: StaffRole;
      userId: number | null;
      employeeProfile: { subAccounts: { role: string } | null } | null;
    } | null;
  } | null;
  // ─── ⚠️ DO NOT REMOVE sessionRenewRecords ──────────────────────────────
  // 历史背景：BUG-1/5/7 修复前，续费会回写 session.prepaidAmount，
  // 导致"开台预付"和"续费"两个资金池混在一起，产生重复抵扣。
  // 修复后 space-session-renew.service.ts 彻底移除了 prepaid* 回写，
  // 因此 session.prepaidAmount **仅包含开台预付款，不含续费金额**。
  // 退款 / 客人应付计算必须从 sessionRenewRecords 独立累加续费金额，
  // 否则续费付款会被忽略，导致：
  //   1. 续费溢出金额无法退还客户（资金损失）
  //   2. 客人应付多算（多收客户钱）
  // 简化方向：不要试图"用 prepaidAmount 代替"或"去掉 sessionRenewRecords"，
  // 这会恢复 BUG-1/5/7 之前的错误行为。
  sessionRenewRecords: {
    amount: number;
    paymentMethod: string;
  }[];
};

export type MembershipContext = NonNullable<
  AuthenticatedUser['currentMembership']
>;

export type DisplayOperatorInfo = {
  name: string | null;
  avatar?: string;
  staffId: number | null;
};

export type OwnedShiftSelection = {
  isCashier: boolean;
  cashierEmployeeId: number | null;
  ownedExactShiftRecord: ShiftRecordRow | null;
};

export type ShiftRecordRow = {
  id?: number;
  employeeId?: number | null;
  employeeName: string;
  shiftType: EmployeeShiftType | null;
  shiftName?: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  createdAt?: Date;
};

export type HandoverOperationAccess = {
  canOperate: boolean;
  blockedReason: string | null;
};

export const HANDOVER_RECORD_INCLUDE =
  Prisma.validator<Prisma.StoreHandoverRecordInclude>()({
    fromEmployee: { select: { id: true, name: true } },
    toEmployee: { select: { id: true, name: true } },
    additionalValues: {
      select: {
        id: true,
        itemId: true,
        itemNameSnapshot: true,
        value: true,
        createdAt: true,
        updatedAt: true,
        item: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  });

export type HandoverRecordSnapshotFields = {
  employeeShiftIdSnapshot?: number | null;
  fromEmployeeNameSnapshot?: string | null;
  shiftTypeSnapshot?: EmployeeShiftType | null;
  shiftNameSnapshot?: string | null;
  shiftStartTimeSnapshot?: string | null;
  shiftEndTimeSnapshot?: string | null;
};

export type HandoverRecordRow = Prisma.StoreHandoverRecordGetPayload<{
  include: typeof HANDOVER_RECORD_INCLUDE;
}> &
  HandoverRecordSnapshotFields;

export type AdditionalItemRow = {
  id: number;
  name: string;
  val?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItemRow = {
  id: number;
  productName: string;
  salePrice: number;
  quantity: number;
  /**
   * id：商品 ID，销售时点库存快照（SaleStockSnapshotIndex）的关联键。
   * 可选仅为兼容测试夹具；SALE_ORDER_ITEM_SELECT 已返回。
   */
  product: { id?: number; stock: number; unit: string } | null;
  order: {
    id: number;
    date: Date;
    paymentMethod: SalesPaymentMethod;
    /** 手工补录单（录入单子）标识：交班明细按整单合并展示（与退款行组成 2 行） */
    manualEntry: boolean;
    /** 手工补录单就餐方式（dineIn=堂食/takeaway=自取/platform=外卖），用于商品名前缀区分 */
    diningMode: string | null;
    /** 手工补录单来源渠道（meituan/eleme/meituanVoucher/douyin/dianping/other），平台结算时用于展示具体来源 */
    sourceChannel: string | null;
    /** 团购券码：录入单子平台结算时填写，交班明细团购券码列展示 */
    grouponCode: string | null;
    operatorNameSnapshot: string | null;
    /** 扫码点餐订单（purelyClub 下单）：携带桌台号与折扣信息用于展示 */
    scanOrder: {
      /** 商品折扣金额（分） */
      productDiscountAmount: number;
      /** 订单折扣金额（分） */
      orderDiscountAmount: number;
      table: {
        tableCode: string;
      } | null;
      /** 扫码订单商品规格快照：与 saleOrderItems 按展开顺序一一对应 */
      items: Array<{
        productNameSnapshot: string;
        quantity: number;
        specs: Array<{ specOptionNameSnapshot: string }>;
      }>;
    } | null;
    operatorStaff: {
      name: string;
      role: StaffRole;
      userId: number | null;
      employeeProfile: {
        subAccounts: { role: StoreSubAccountRole } | null;
      } | null;
    } | null;
    spaceSession: {
      startTime: Date;
      /** 空间会话商品行规格（非扫码订单的规格来源）：与 saleOrderItems 行级一一对应 */
      sessionItems: Array<{
        productName: string;
        specNames: unknown;
      }>;
      prepaidPaymentMethod: SalesPaymentMethod | null;
      prepaidCustomerPaymentMethod: string | null;
      prepaidGrouponPlatform: string | null;
      prepaidGrouponCode: string | null;
      /** 开台预付款金额（分）：消费行支付方式归属的资金池来源之一 */
      prepaidAmount: number | null;
      /// Step 8.1: renewRecords 已拆为独立表
      sessionRenewRecords: Array<{
        paymentMethod: string;
        amount: number;
        renewedAt: bigint;
        grouponPlatform: string | null;
        grouponCode: string | null;
      }>;
      space: {
        name: string;
      } | null;
      openOperatorNameSnapshot: string | null;
      openOperatorStaff: {
        name: string;
        role: StaffRole;
        userId: number | null;
        employeeProfile: {
          subAccounts: { role: StoreSubAccountRole } | null;
        } | null;
      } | null;
    } | null;
  };
};

/**
 * 支付方式汇总（mapPaymentItems / buildSpaceConsumptionPaymentIndex /
 * resolveOrderItemPaymentMethod）所需的最小字段集。
 *
 * 交班页有两条 SaleOrderItem 查询，结构上都满足本类型，因此支付口径共用一套逻辑：
 * - loadPaymentOrderItems：班次内全量（无 take），仅用于支付汇总，
 *   用 PAYMENT_ORDER_ITEM_SELECT（slim，无深层嵌套展示字段）
 * - loadRecentOrderItems：take 999，用于明细展示 + 库存快照，
 *   用 SALE_ORDER_ITEM_SELECT（全量字段）
 *
 * scanOrder 仅需判断是否为扫码点餐订单（非 null 即归入团购桶），
 * 两条查询的 select 形状不同，故用 unknown 兼容。
 */
export type PaymentOrderItemSource = {
  id: number;
  productName: string;
  salePrice: number;
  quantity: number;
  order: {
    id: number;
    paymentMethod: SalesPaymentMethod;
    grouponCode: string | null;
    scanOrder: unknown;
    spaceSession: {
      prepaidPaymentMethod: SalesPaymentMethod | null;
      prepaidCustomerPaymentMethod: string | null;
      prepaidGrouponPlatform: string | null;
      prepaidGrouponCode: string | null;
      prepaidAmount: number | null;
      sessionRenewRecords: Array<{
        paymentMethod: string;
        amount: number;
        renewedAt: bigint;
        grouponPlatform: string | null;
        grouponCode: string | null;
      }>;
    } | null;
  };
};

export type RefundOrderRow = {
  id: number;
  date: Date;
  paymentMethod: SalesPaymentMethod;
  totalRevenue: number;
  operatorNameSnapshot: string | null;
  operatorStaff: {
    name: string;
    role: StaffRole;
    userId: number | null;
    employeeProfile: {
      subAccounts: { role: StoreSubAccountRole } | null;
    } | null;
  } | null;
  spaceSession: {
    space: {
      name: string;
    };
  } | null;
};

/** 扫码点餐退款行（SaleOrderRefund）：拒绝订单退款后在交班明细中展示为负数退款行 */
export type SaleOrderRefundRow = {
  id: number;
  /** 退款金额（分） */
  amount: number;
  paymentMethod: SalesPaymentMethod;
  refundedAt: Date;
  saleOrder: {
    id: number;
    date: Date;
    /** 手工补录单（录入单子）标识：退款行商品名展示「堂食/外卖 · xxx」 */
    manualEntry: boolean;
    /** 手工补录单就餐方式：退款行商品名前缀区分堂食/外卖 */
    diningMode: string | null;
    /** 手工补录单来源渠道：退款行支付标签展示具体来源（如退回美团团购） */
    sourceChannel: string | null;
    operatorNameSnapshot: string | null;
    operatorStaff: {
      name: string;
      role: StaffRole;
      userId: number | null;
      employeeProfile: {
        subAccounts: { role: StoreSubAccountRole } | null;
      } | null;
    } | null;
    scanOrder: {
      table: {
        tableCode: string;
      } | null;
    } | null;
    /** 订单商品项：退款行展示原商品名（取第一条） */
    items: Array<{
      productName: string;
      /** 商品当前库存：退款行展示退款后恢复的库存（与下单行保持一致） */
      product: { stock: number; unit: string } | null;
    }>;
  };
};

export type ShiftDateRange = {
  startAt: Date;
  endAt: Date;
};

export type RecordShiftSnapshot = {
  employeeId?: number | null;
  employeeName?: string | null;
  shiftType: EmployeeShiftType | null;
  shiftName?: string | null;
  date?: Date;
  startTime: string;
  endTime: string;
};

export type RecordViewContext = {
  referenceDate: Date;
  shiftRecord: RecordShiftSnapshot | null;
  shiftRange: ShiftDateRange;
  operatorName: string;
  operatorStaffId: number | null;
  operatorAvatar: string | null;
};

export type ReceiverCandidate = {
  employeeId: number;
  employeeName: string;
  subAccountId: number | null;
  shiftDate?: Date;
  shiftStartTime?: string;
  shiftEndTime?: string;
};

export type ResolvedPageShiftSelection = {
  ownedSelection: OwnedShiftSelection;
  shiftRecord: ShiftRecordRow | null;
  operationShiftRecord: ShiftRecordRow | null;
};

export type HandoverPageMetrics = {
  orderCount: number;
  /** 班次内全量订单明细（slim select），仅用于支付方式金额汇总 */
  paymentOrderItems: PaymentOrderItemSource[];
  /** 班次内最近 999 条订单明细（全量 select），用于明细展示与库存快照 */
  orderItems: OrderItemRow[];
  /** 销售时点库存快照（saleOrderId+productId → afterStock）：库存列展示用 */
  saleStockIndex: SaleStockSnapshotIndex;
  /** 扫码点餐退款行（SaleOrderRefund）：在交班明细中展示为负数退款行 */
  saleOrderRefundItems: SaleOrderRefundRow[];
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
  pettyCashAmount: number;
  settledSpaceSessions: SettledSpaceSessionRow[];
  /** 门店主账号 user.id（store.ownerId），用于操作员职位判定 */
  storeOwnerUserId: number | null;
};

export const EMPTY_METRICS: HandoverPageMetrics = {
  orderCount: 0,
  paymentOrderItems: [],
  orderItems: [],
  saleStockIndex: new Map(),
  saleOrderRefundItems: [],
  additionalRevenueAmount: 0,
  spaceRevenueAmount: 0,
  refundAmount: 0,
  pettyCashAmount: 0,
  settledSpaceSessions: [],
  storeOwnerUserId: null,
};

export type ResolvedHandoverPageShiftContext = {
  membership: MembershipContext;
  shiftRecord: ShiftRecordRow | null;
  shiftInfo: HandoverShiftInfoDto;
  operationAccess: HandoverOperationAccess;
  displayOperatorStaffId: number | null;
  receiverCandidate: ReceiverCandidate | null;
  handoverCompletedAndNoUpcomingShift: boolean;
};
