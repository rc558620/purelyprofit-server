import type { Prisma } from '@prisma/client';
import { parseAssignmentsJson } from '../commission/commission.utils';
import {
  GROUPON_VOUCHER_ITEM_SUFFIX,
  isSpaceSessionDeductionProductId,
  SYS_GROUPON_VOUCHER_PRODUCT_ID,
  SYS_TIME_BILLING_PRODUCT_ID,
} from './space-session-settlement-system-item.shared';

/** 从结账结果里取护理档案所需快照的最小输入 */
export interface CareRecordSnapshotSource {
  session: {
    sessionItems: Array<{ productId: string; productName: string }>;
    commissionAssignments: Prisma.JsonValue | null;
  };
  salesOrder: { totalRevenue: number };
}

export interface CareRecordSnapshot {
  /** 护理项目名：剔除系统抵扣项与台位费行后的消费项目名，以「、」连接 */
  serviceName: string;
  /** 护理师姓名：提成分配排序后的第一个；无技师时为 null */
  technicianName: string | null;
  /** 本次消费金额（元） */
  amountYuan: number;
}

/**
 * 从结账结果推导护理档案的只读快照。
 *
 * 这些字段在结账写入时**固化一次**，后续改名 / 改价不回溯：
 * 护理档案描述的是「当时做了什么」，不是「现在的商品叫什么」。
 *
 * `voucherProductName`：purelyClub 团购券开台的会话，券对应商品（如「泡沐浴盐护理」）
 * 才是本次护理的真实项目，会话行里只有「台位费 X分钟」计费行——把它放在展示名最前。
 */
export function buildCareRecordSnapshot(
  source: CareRecordSnapshotSource,
  voucherProductName?: string | null,
): CareRecordSnapshot {
  return {
    serviceName: buildServiceName(
      source.session.sessionItems,
      voucherProductName,
    ),
    technicianName: resolveTechnicianName(source.session.commissionAssignments),
    amountYuan: source.salesOrder.totalRevenue,
  };
}

function buildServiceName(
  sessionItems: CareRecordSnapshotSource['session']['sessionItems'],
  voucherProductName?: string | null,
): string {
  // 券面消费行（如「分手大师（团购券）」）不能与 voucherProductName 重复计入，
  // 否则服务名会变成「分手大师、分手大师（团购券）」。
  // 但券商品名查不到时（第三方手工券），券面行的兜底名是唯一可用的展示名，
  // 此时去掉「（团购券）」后缀后仍作为服务名。
  const voucherItem = sessionItems.find(
    (item) => item.productId === SYS_GROUPON_VOUCHER_PRODUCT_ID,
  );
  const voucherName =
    voucherProductName?.trim() ||
    (voucherItem
      ? voucherItem.productName
          .replace(new RegExp(`${GROUPON_VOUCHER_ITEM_SUFFIX}$`), '')
          .trim()
      : '');

  const names = [
    ...(voucherName ? [voucherName] : []),
    ...sessionItems
      .filter(
        (item) =>
          !isSpaceSessionDeductionProductId(item.productId) &&
          // 台位费是计费系统行，不是护理项目：护理档案不向会员展示「台位费 X分钟」
          item.productId !== SYS_TIME_BILLING_PRODUCT_ID &&
          // 券面消费行同上，其展示名已由 voucherName 承载
          item.productId !== SYS_GROUPON_VOUCHER_PRODUCT_ID,
      )
      .map((item) => item.productName.trim()),
  ].filter(Boolean);
  return names.join('、') || EMPTY_SERVICE_NAME_FALLBACK;
}

/** 台位费行命名兼容：「台位费（固定）/ 台位费（按单价）」与「台位费 1分钟」（计时模式无括号） */
const TABLE_FEE_NAME_RE = /^台位费(（|\s|$)/;

/** 服务名整体缺失时的兜底展示名（与会话空结算占位行同名） */
export const EMPTY_SERVICE_NAME_FALLBACK = '场地结账';

/**
 * 剔除服务名中的台位费段（按「、」分段）：
 * 「台位费 1分钟、助眠疗愈」→「助眠疗愈」；仅台位费行 / 为空 → 空串。
 * 台位费是计费系统行，不构成护理项目，B/C 端展示前一律剔除。
 */
export function stripTableFeeSegments(serviceName: string): string {
  return serviceName
    .split('、')
    .map((segment) => segment.trim())
    .filter((segment) => segment && !TABLE_FEE_NAME_RE.test(segment))
    .join('、');
}

/**
 * 服务名是否「仅由台位费行构成」（或为空）：这类名称剔除台位费段后不再有
 * 任何护理项目，B/C 端读取链路需用团购商品名兜底展示。
 */
export function isTableFeeOnlyServiceName(serviceName: string): boolean {
  return stripTableFeeSegments(serviceName) === '';
}

/**
 * 依开台绑定的纯利宝券码反查团购商品名（护理档案展示名来源）。
 * 无券码（普通开台）/ 查不到（手工第三方券）→ null，调用方按无券处理。
 */
export async function resolveVoucherProductName(
  db: Pick<CareRecordVoucherNameStore, 'clubVoucherOrder'>,
  storeId: number,
  voucherCode: string | null | undefined,
): Promise<string | null> {
  const trimmed = voucherCode?.trim();
  if (!trimmed) {
    return null;
  }
  const order = await db.clubVoucherOrder.findFirst({
    where: { storeId, voucherCode: trimmed },
    select: { productName: true },
  });
  return order?.productName ?? null;
}

/**
 * 批量反查团购商品名（读取链路历史数据兜底）：
 * careRecord.sessionId → space_sessions.prepaid_voucher_code → club_voucher_orders.product_name。
 * 写侧已固化正确展示名，这里只覆盖「台位费行」时代产生的存量记录。
 */
export async function resolveVoucherProductNamesBySessionIds(
  db: CareRecordVoucherNameStore,
  storeId: number,
  sessionIds: Array<number | undefined>,
): Promise<Map<number, string>> {
  const nameBySessionId = new Map<number, string>();
  const ids = [...new Set(sessionIds)].filter(
    (id): id is number =>
      typeof id === 'number' && Number.isInteger(id) && id > 0,
  );
  if (ids.length === 0) {
    return nameBySessionId;
  }

  const sessions = await db.spaceSession.findMany({
    where: { id: { in: ids }, storeId },
    select: { id: true, prepaidVoucherCode: true },
  });
  const voucherCodes = [
    ...new Set(
      sessions
        .map((session) => session.prepaidVoucherCode?.trim())
        .filter((code): code is string => !!code),
    ),
  ];
  if (voucherCodes.length === 0) {
    return nameBySessionId;
  }

  const orders = await db.clubVoucherOrder.findMany({
    where: { storeId, voucherCode: { in: voucherCodes } },
    select: { voucherCode: true, productName: true },
  });
  const nameByCode = new Map(
    orders
      .filter((order) => order.voucherCode)
      .map((order) => [order.voucherCode as string, order.productName]),
  );
  for (const session of sessions) {
    const name = session.prepaidVoucherCode
      ? nameByCode.get(session.prepaidVoucherCode.trim())
      : undefined;
    if (name) {
      nameBySessionId.set(session.id, name);
    }
  }
  return nameBySessionId;
}

/** 护理档案链路所需的最小 DB 读取面（结构类型，PrismaService / 事务客户端均满足） */
interface CareRecordVoucherNameStore {
  spaceSession: {
    findMany(
      args: Prisma.SpaceSessionFindManyArgs,
    ): Promise<Array<{ id: number; prepaidVoucherCode: string | null }>>;
  };
  clubVoucherOrder: {
    findFirst(
      args: Prisma.ClubVoucherOrderFindFirstArgs,
    ): Promise<Prisma.ClubVoucherOrderGetPayload<{
      select: { productName: true };
    }> | null>;
    findMany(
      args: Prisma.ClubVoucherOrderFindManyArgs,
    ): Promise<Array<{ voucherCode: string | null; productName: string }>>;
  };
}

function resolveTechnicianName(
  commissionAssignments: Prisma.JsonValue | null,
): string | null {
  const assignments = parseAssignmentsJson(commissionAssignments);
  return assignments[0]?.technicianName?.trim() || null;
}
