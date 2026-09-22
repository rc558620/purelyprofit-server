/**
 * 自助下单支付共用契约
 *
 * 支付编排与其协作类（仓储 / 落账 / 通知）共享的结构与常量集中在此，
 * 避免同一份结构在多处重复声明。
 */

/**
 * 待支付订单（含商品行快照）
 *
 * 显式声明结构而非引用 Prisma.SelfOrderGetPayload：该工具类型来自生成期 client，
 * Prisma 重新生成 / pnpm 路径变化时 IDE 的 TS Server 常因缓存滞后误报「不存在」
 * （命令行 tsc 实际通过）。TS 结构化类型下，查询返回的超集对象可直接赋值，
 * 显式声明对这类生成时序问题免疫，同时保留关键字段的显式契约。
 */
export interface PayableOrder {
  id: number;
  orderNo: string;
  storeId: number;
  sessionId: number;
  spaceId: number;
  clubUserId: number;
  remark: string | null;
  /** 商品合计（分）；无优惠场景恒等于应付金额 */
  itemTotalAmount: number;
  /** 应付金额（分） */
  payableAmount: number;
  paidAmount: number;
  status: string;
  paymentStatus: string;
  /** 乐观锁版本：落账时做 CAS 条件更新 */
  version: number;
  paidAt: Date | null;
  createdAt: Date;
  items: Array<{
    id: number;
    productId: string;
    productName: string;
    categoryName: string | null;
    /** 销售单价快照（分） */
    salePrice: number;
    /** 成本单价快照（分） */
    costPrice: number;
    quantity: number;
    /** 规格签名（选项 ID 升序 sha256）；无规格时为 null */
    specSignature: string | null;
    /** 规格明细（落库快照，用于取规格名写入空间账单） */
    specs: Array<{ specOptionNameSnapshot: string }>;
  }>;
}

/** 微信支付在途状态：存在其中任一即拒绝重复发起 */
export const IN_FLIGHT_ATTEMPT_STATUSES = ['pending', 'paying', 'created'];

/**
 * 在途支付尝试的存活时限：超过后允许重新发起支付。
 * 用户拉起微信收银台后放弃/切后台时，旧尝试会一直停留 created/paying，
 * 若不过期将阻塞同订单重试（409 直到订单超时）。微信侧即使迟到支付成功，
 * 回调仍能凭 merchantPaymentNo 幂等落账，不会被该清理误伤。
 */
export const SELF_ORDER_ATTEMPT_TTL_MS = 5 * 60 * 1000;

/** 订单落账参数（渠道 / 商户单号 / 流水号 / 余额流水） */
export interface SettlePaidOrderParams {
  channel: string;
  merchantPaymentNo: string;
  /** 微信支付流水号（回调落账时传入，余额/开发态确认为空） */
  transactionId?: string;
  balanceTransaction?: { customerId: number; amount: number };
}
