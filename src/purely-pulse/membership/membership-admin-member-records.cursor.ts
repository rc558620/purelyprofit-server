import type { PulseAdminMemberRecordTypeValue } from './dto/pulse-membership-admin-member-records.shared.dto';

/**
 * 会员记录游标。
 *
 * 四类记录分散在三张表、各自独立自增，「时间戳_自增id」这种两段式游标会跨表碰撞：
 * 订单 id=128 与审计 id=128 完全可能同时存在，同毫秒命中时翻页会整条漏掉。
 * 因此游标编成 `时间戳_类型_自增id` 三段，并用类型序号参与比较（见下方 RANK）。
 */
export interface MemberRecordCursor {
  createdAt: Date;
  type: PulseAdminMemberRecordTypeValue;
  id: number;
}

/**
 * 同毫秒时的稳定排序序号（倒序排列，数字大的在前）。
 *
 * 只在「createdAt 完全相等」时才起作用，取值本身没有业务含义，
 * 唯一要求是固定不变 —— 换顺序会让已发出的游标失效。
 */
const MEMBER_RECORD_TYPE_RANK: Record<PulseAdminMemberRecordTypeValue, number> =
  {
    recharge: 1,
    adminGrant: 2,
    renewalAdjust: 3,
    subAccount: 4,
  };

const CURSOR_PATTERN =
  /^(\d+)_(recharge|adminGrant|renewalAdjust|subAccount)_(\d+)$/;

export function encodeMemberRecordCursor(
  row: MemberRecordCursor | null,
): string | null {
  if (!row) {
    return null;
  }

  return `${row.createdAt.getTime()}_${row.type}_${row.id}`;
}

/** 解析游标；缺失或格式不合法时返回 null（由调用方决定是报错还是从头查）。 */
export function parseMemberRecordCursor(
  raw: string | null | undefined,
): MemberRecordCursor | null {
  if (!raw) {
    return null;
  }

  const match = CURSOR_PATTERN.exec(raw);
  if (!match) {
    return null;
  }

  const [, rawCreatedAt, rawType, rawId] = match;
  const createdAtMs = Number(rawCreatedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    createdAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    createdAt: new Date(createdAtMs),
    type: rawType as PulseAdminMemberRecordTypeValue,
    id,
  };
}

/**
 * 三张表 where 的公共过滤片段：只用 createdAt / id 两个过滤键。
 *
 * 刻意不引用 Prisma 生成的模型级 WhereInput —— 后者跟随 `prisma generate` 的时序，
 * schema 新增模型而 client 未重新生成时会解析成 error type（等同 any），
 * 类型保护整条失效。这里用结构子集表达，spread 进 where 后
 * 仍由 Prisma 的参数类型做结构校验，生成物的新旧不再影响类型安全。
 */
export interface MemberRecordCursorFilter {
  createdAt?: Date | { lt: Date };
  id?: { lt: number };
}

/**
 * 构造「排在游标之后」的查询条件（Prisma 的 OR 数组）。
 *
 * 全局排序是 `createdAt desc → 类型序号 desc → id desc`，游标代表上一页最后一行，
 * 下一页只取严格排在它后面的行：
 * - 时间更早的一定在后面，无条件下发
 * - 同一毫秒时：本表类型序号比游标小 → 排在后面，整段取；相等 → 只取 id 更小的；
 *   比游标大 → 上一页已经返回过，跳过
 *
 * `selfType` 是本查询唯一产出的记录类型：订单表按支付渠道拆成两次查询，
 * 每次只对应一种类型，因此这里不需要再叠加渠道条件（叠加反而会与查询自身的渠道条件相交为空）。
 */
export function buildMemberRecordCursorWhere(
  cursor: MemberRecordCursor | null,
  selfType: PulseAdminMemberRecordTypeValue,
): MemberRecordCursorFilter[] | undefined {
  if (!cursor) {
    return undefined;
  }

  const cursorRank = MEMBER_RECORD_TYPE_RANK[cursor.type];
  const selfRank = MEMBER_RECORD_TYPE_RANK[selfType];
  const branches: MemberRecordCursorFilter[] = [
    { createdAt: { lt: cursor.createdAt } },
  ];

  if (selfRank < cursorRank) {
    branches.push({ createdAt: cursor.createdAt });
  } else if (selfRank === cursorRank) {
    branches.push({ createdAt: cursor.createdAt, id: { lt: cursor.id } });
  }

  return branches;
}

/** 跨类型合并排序：时间倒序 → 类型序号倒序 → id 倒序，与游标比较规则严格一致。 */
export function compareMemberRecordsDesc(
  a: MemberRecordCursor,
  b: MemberRecordCursor,
): number {
  const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const rankDiff =
    MEMBER_RECORD_TYPE_RANK[b.type] - MEMBER_RECORD_TYPE_RANK[a.type];
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return b.id - a.id;
}
