// 客存（B 端）内部流转类型：service 之间传递的中间结构，不对外暴露为接口契约
import type {
  CustodyOrder,
  CustodyPickup,
  CustodySetting,
  Prisma,
} from '@prisma/client';

/** 列表/详情选择的存单字段集（含关联商品名的快照语义，避免额外 join） */
export type CustodyOrderRecord = CustodyOrder;
export type CustodyPickupRecord = CustodyPickup;
export type CustodySettingRecord = CustodySetting;

/** 列表查询入参 */
export interface CustodyListParams {
  /** 门店 ID（由鉴权解析，已校验可访问） */
  storeId: number;
  /** 状态筛选：all 或具体状态 */
  status: string;
  /** 关键字：会员姓名/手机号/商品名/存放位置 */
  keyword: string;
  /** 游标（首次查询为空） */
  cursor?: string;
  /** 每页条数 */
  limit: number;
}

/** 游标分页上下文 */
export interface CustodyCursorContext {
  /** 游标对应的创建时间 */
  createdAt: Date;
  /** 游标对应的主键 */
  id: number;
}

/** 列表查询构造结果 */
export interface CustodyListQuery {
  /** Prisma 查询条件 */
  where: Prisma.CustodyOrderWhereInput;
  /** 排序条件 */
  orderBy: Prisma.CustodyOrderOrderByWithRelationInput[];
  /** 取值条数（多取一条用于判断是否有下一页） */
  take: number;
}

/** 发起存入的会员快照（写入后不回刷） */
export interface CustodyMemberSnapshot {
  /** 会员主键 */
  memberId: number;
  /** 会员姓名快照 */
  memberName: string;
  /** 会员手机号快照 */
  memberPhone: string;
}

/** 发起存入的写入入参 */
export interface CustodyCreateInput {
  /** 门店 ID */
  storeId: number;
  /** 经手店员 ID（系统行为可为 null） */
  createdByStaffId: number | null;
  /** 经手店员姓名快照 */
  createdByName: string | null;
  /** 会员快照 */
  member: CustodyMemberSnapshot;
  /** 商品 ID（可空，散客登记场景） */
  productId: number | null;
  /** 商品名 */
  productName: string;
  /** 规格名快照 */
  specName: string | null;
  /** 计量单位快照 */
  unit: string;
  /** 存入总量 */
  totalQty: number;
  /** 存放位置 */
  location: string | null;
  /** 存入时间 */
  storedAt: Date;
  /** 到期时间（null 表示长期有效） */
  expireAt: Date | null;
  /** 库存口径 */
  stockMode: 'sold' | 'frozen';
  /** 来源销售单 ID */
  sourceOrderId: number | null;
  /** 备注 */
  note: string | null;
  /** 幂等键 */
  idempotencyKey: string | null;
}

/** 取出核销的写入入参 */
export interface CustodyPickupInput {
  /** 门店 ID */
  storeId: number;
  /** 存单主键 */
  custodyOrderId: number;
  /** 取出数量 */
  qty: number;
  /** 核销店员 ID */
  operatorStaffId: number | null;
  /** 核销店员姓名快照 */
  operatorName: string | null;
  /** 关联消费单 ID */
  relatedOrderId: number | null;
  /** 幂等键 */
  idempotencyKey: string | null;
}
