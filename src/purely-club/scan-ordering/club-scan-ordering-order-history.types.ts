import type { Prisma } from '@prisma/client';
import type { OrderAmountSummary } from './club-scan-ordering-order.mapper';

/**
 * 单个会话内联返回的订单数上界（护栏，不是分页）。
 *
 * 依据本地真实库分布：每会话订单数 p50=1 / p90=5 / p99≈29 / **max=58**。
 * 取 100 = 实测最大值的 1.7 倍，正常经营不会触界；它只用于阻断"脏写入 /
 * 异常重试把单个会话堆成上千单"导致的无界响应。
 *
 * 触界时**不允许静默少展示**：响应里会置 `ordersTruncated: true`。当前
 * purelyClub 尚未消费该标记（`shared/OrderCard` 无"查看全部"入口），所以
 * 触界即等于少展示，属于已知残差；接前端"查看全部"时以该标记为准。
 *
 * 复测方法（线上或本地）：
 *   SELECT max(c) FROM (
 *     SELECT session_id, count(*) AS c FROM scan_orders
 *     WHERE deleted_at IS NULL GROUP BY session_id
 *   ) t;
 * 若逼近 100，说明护栏需要重新评估（应改为按会话维度分页或列表不内联明细）。
 */
export const CLUB_ORDER_HISTORY_MAX_ORDERS_PER_SESSION = 100;

/**
 * 单个订单内联返回的明细行数上界（护栏，不是分页）。
 *
 * 依据本地真实库分布：每订单明细数 p50=1 / p90=4 / p99≈7.5 / **max=17**。
 * 取 50 = 实测最大值的 2.9 倍。触界时置 `itemsTruncated: true`。
 *
 * 复测方法：
 *   SELECT max(c) FROM (
 *     SELECT order_id, count(*) AS c FROM scan_order_items GROUP BY order_id
 *   ) t;
 */
export const CLUB_ORDER_HISTORY_MAX_ITEMS_PER_ORDER = 50;

/**
 * 订单历史读投影。
 *
 * 与 4-1 菜单同理：只取响应组装真正需要的列，但这里刻意**保留**部分
 * "前端不读、后端要用"的列，避免二次取数：
 *  - `marketingSnapshot`（JSON 快照，实测平均 500 B / 最大 817 B）：前端全仓
 *    仅类型声明与注释命中、运行时零读取；但 `toOrderAmountSummary` 依赖它派生
 *    `pointsDeductAmount` 与 `discountItems`，因此**留在 select、只在响应里剔除**
 *    （见 service 的 `toHistoryOrder`）。重会话里它约占响应 2/3。
 *  - `items.menuProductId`：前端类型未声明、运行时零读取；但服务端要用它做
 *    `productImageUrlSnapshot` 的兜底映射，同样留 select、剔响应。
 *  - `pickupBusinessDate`：前端全仓 **0 命中**（连类型都没有），直接从 select
 *    移除，不再参与传输。
 *  - `unitPriceAmount` / `itemOriginalAmount` / `specificationExtraAmount` /
 *    `servedAt` / `fulfillmentStatus` 等虽未被运行时读取，但属于前端类型已声明
 *    的金额/状态口径（`OrderAmountSummary` 审计基数），保留以免口径分裂。
 *
 * `orders` / `items` 各多取 1 行（`+1`）用于判定是否触界，切片后置 truncated 标记。
 */
export const CLUB_ORDER_HISTORY_SESSION_SELECT = {
  id: true,
  diningRoundId: true,
  storeId: true,
  guestCount: true,
  status: true,
  createdAt: true,
  endedAt: true,
  archiveReason: true,
  table: {
    select: {
      id: true,
      tableCode: true,
      name: true,
      area: { select: { name: true } },
      type: { select: { name: true } },
    },
  },
  orders: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CLUB_ORDER_HISTORY_MAX_ORDERS_PER_SESSION + 1,
    select: {
      id: true,
      orderNo: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      payableAmount: true,
      paidAmount: true,
      itemOriginalAmount: true,
      specificationExtraAmount: true,
      productDiscountAmount: true,
      orderDiscountAmount: true,
      marketingSnapshot: true,
      remark: true,
      createdAt: true,
      servedAt: true,
      pickupNumber: true,
      pickupNumberStatus: true,
      pickupCalledAt: true,
      pickupCompletedAt: true,
      paymentAttempts: {
        where: { status: { in: ['succeeded', 'refunded'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { paymentChannel: true },
      },
      items: {
        orderBy: { sortOrder: 'asc' },
        take: CLUB_ORDER_HISTORY_MAX_ITEMS_PER_ORDER + 1,
        select: {
          menuProductId: true,
          productNameSnapshot: true,
          productImageUrlSnapshot: true,
          quantity: true,
          // 暴露金额字段用于订单详情规格样式展示。
          unitPriceAmount: true,
          lineTotalAmount: true,
          payableLineAmount: true,
          specs: {
            orderBy: { id: 'asc' },
            select: { specOptionNameSnapshot: true },
          },
        },
      },
      refundTasks: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          status: true,
          refundSucceededAt: true,
          processedAt: true,
          triggeredAt: true,
        },
      },
      balanceTransactions: {
        where: { type: 'refund' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  },
} as const satisfies Prisma.ScanOrderingSessionSelect;

export type ClubOrderHistorySessionRow = Prisma.ScanOrderingSessionGetPayload<{
  select: typeof CLUB_ORDER_HISTORY_SESSION_SELECT;
}>;
export type ClubOrderHistoryOrderRow =
  ClubOrderHistorySessionRow['orders'][number];
export type ClubOrderHistoryItemRow = ClubOrderHistoryOrderRow['items'][number];
export type ClubOrderHistoryRefundTaskRow =
  ClubOrderHistoryOrderRow['refundTasks'][number];

/** 明细行对外结构（金额已换算为元，`menuProductId` 不透出） */
export interface ClubOrderHistoryItemResponse {
  productNameSnapshot: ClubOrderHistoryItemRow['productNameSnapshot'];
  productImageUrlSnapshot: string | null;
  quantity: number;
  unitPriceAmount: number;
  lineTotalAmount: number;
  payableLineAmount: number;
  specs: { specOptionNameSnapshot: string }[];
}

/**
 * 退款任务对外结构（只透出展示所需的最新一条）。
 *
 * 除 `refundSucceededAt` 被折叠成 ISO 字符串外，其余列保持原样透出
 * （含 `processedAt` / `triggeredAt`，Nest 序列化时转为 ISO）——前端
 * `orderTime.ts` 依赖 `refundSucceededAt` 这一路兜底，删列属于契约变更，
 * 本批不做。
 */
export interface ClubOrderHistoryRefundTaskResponse extends Omit<
  ClubOrderHistoryRefundTaskRow,
  'refundSucceededAt'
> {
  refundSucceededAt: string | null;
}

/** 订单对外结构：DB 列 + `toOrderAmountSummary` 换算后的金额 + 展示辅助字段 */
export interface ClubOrderHistoryOrderResponse extends OrderAmountSummary {
  id: number;
  orderNo: string;
  status: ClubOrderHistoryOrderRow['status'];
  paymentStatus: ClubOrderHistoryOrderRow['paymentStatus'];
  fulfillmentStatus: ClubOrderHistoryOrderRow['fulfillmentStatus'];
  remark: string | null;
  createdAt: string;
  servedAt: string | null;
  pickupNumber: number | null;
  pickupNumberLabel: string | null;
  pickupNumberStatus: ClubOrderHistoryOrderRow['pickupNumberStatus'];
  pickupCalledAt: string | null;
  pickupCompletedAt: string | null;
  paymentAttempts: { paymentChannel: string | null }[];
  refundTasks: ClubOrderHistoryRefundTaskResponse[];
  balanceTransactions: { createdAt: string }[];
  items: ClubOrderHistoryItemResponse[];
  /** 明细被上界截断（当前前端未消费，接入"查看全部"时以此为准） */
  itemsTruncated: boolean;
}

/** 会话（= 一次用餐轮次）对外结构 */
export interface ClubOrderHistorySessionResponse {
  id: number;
  diningRoundId: string;
  storeId: number;
  guestCount: number;
  status: ClubOrderHistorySessionRow['status'];
  createdAt: string;
  endedAt: string | null;
  archiveReason: ClubOrderHistorySessionRow['archiveReason'];
  table: ClubOrderHistorySessionRow['table'];
  orders: ClubOrderHistoryOrderResponse[];
  /** 订单被上界截断（合并同轮次后统计，当前前端未消费） */
  ordersTruncated: boolean;
}

export interface ClubOrderHistoryResponse {
  items: ClubOrderHistorySessionResponse[];
  nextCursor: number | null;
}
