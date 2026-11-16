/**
 * C 端列表 keyset（游标）分页公共能力：游标编解码 + 「降序 + NULLS LAST」全序条件构造。
 *
 * 为什么必须共用一份实现：
 * - 排序键声明与 WHERE 条件必须来自**同一份 spec**，否则极易出现「排序按 A、过滤按 B」
 *   导致翻页漏读 / 重复读（第 1 批 kindRank 教训）。
 * - 券订单的 `usedAt / refundAt / expiresAt` 可为 NULL，且产品口径是 `DESC NULLS LAST`。
 *   Prisma 的 `orderBy` 支持 `nulls: 'last'`，但 WHERE 侧没有现成语义，必须显式展开。
 *
 * 游标载荷语义（与 `src/shared/cursor-pagination.utils.ts` 共用编码格式）：
 * - `keys`：按 spec 顺序排列的排序键值，时间统一编码为毫秒数，SQL NULL 用 `'null'` 占位；
 * - `id`：唯一主键，永远是最后一级 tie-breaker，保证全序。
 *
 * 注意：解码结果是 **Date** 而不是毫秒数——Prisma 的 DateTime 过滤只接受 `Date` / ISO 串，
 * 直接传毫秒数字会在运行时被参数校验拒绝。
 */
import { BadRequestException } from '@nestjs/common';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../shared/cursor-pagination.utils';

/** 游标中表示 SQL NULL 的占位符：CursorPayload 的 keys 只接受 string | number */
const NULL_KEY_TOKEN = 'null';

/** 单个排序键声明：字段名 + 是否可空（可空键按 NULLS LAST 参与全序） */
export interface ClubCursorKeySpec {
  /** 数据库字段名，必须与查询 orderBy 同序号条目一致 */
  readonly field: string;
  /** 该字段是否允许 NULL；允许时 NULL 排在所有非空值之后 */
  readonly nullable: boolean;
}

/** 解码后的游标位置：排序键值（NULL 表示为 null）+ 主键 */
export interface ClubCursorPosition {
  readonly values: ReadonlyArray<Date | null>;
  readonly id: number;
}

/** 时间键归一：Date → 毫秒数，缺失值保持 null（供编码与相等比较使用） */
export const toCursorValue = (value: Date | null): number | null =>
  value ? value.getTime() : null;

/**
 * 编码游标：把「本页最后一行」的排序键值与主键封装成不透明字符串。
 *
 * 必须传**本页最后一行已返回**的行，不能传多取的那一行（否则会跳过一次页边界）。
 */
export function encodeClubCursor(
  values: ReadonlyArray<Date | null>,
  id: number,
): string {
  return encodeCursor({
    keys: values.map((value) => {
      const numeric = toCursorValue(value);
      return numeric === null ? NULL_KEY_TOKEN : numeric;
    }),
    id,
  });
}

/**
 * 解码游标。
 *
 * @returns 未传游标返回 null（第一页）。
 * @throws BadRequestException 游标格式非法、键数量与当前排序 spec 不一致、
 *         或可空性不匹配（例如把别的 Tab 的游标拿过来用）。
 */
export function decodeClubCursor(
  raw: string | undefined,
  spec: ReadonlyArray<ClubCursorKeySpec>,
): ClubCursorPosition | null {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  if (payload.keys.length !== spec.length) {
    throw invalidClubCursor();
  }

  const values = payload.keys.map((key, index): Date | null => {
    const keySpec = spec[index];
    if (key === NULL_KEY_TOKEN) {
      if (!keySpec.nullable) {
        throw invalidClubCursor();
      }
      return null;
    }
    if (typeof key !== 'number') {
      throw invalidClubCursor();
    }
    return new Date(key);
  });

  return { values, id: payload.id };
}

/**
 * 构造「当前页之后」的 WHERE 条件。
 *
 * 语义：字段按 DESC 排序，可空字段 NULL 排在最后；末级以 `id < cursor.id` 兜底。
 * 生成的是嵌套 OR 结构（每层最多 3 个分支），深度 = spec 长度 + 1，不做指数展开。
 */
export function buildClubKeysetWhere<TWhere>(
  spec: ReadonlyArray<ClubCursorKeySpec>,
  position: ClubCursorPosition,
): TWhere {
  let condition: Record<string, unknown> = { id: { lt: position.id } };
  for (let index = spec.length - 1; index >= 0; index -= 1) {
    condition = buildLevelCondition(
      spec[index],
      position.values[index],
      condition,
    );
  }
  return condition as TWhere;
}

/** 单层条件：值更小 / 值为 NULL（NULLS LAST 下属于「之后」）/ 值相等则看更深一层 */
function buildLevelCondition(
  keySpec: ClubCursorKeySpec,
  value: Date | null,
  deeper: Record<string, unknown>,
): Record<string, unknown> {
  const branches: Array<Record<string, unknown>> = [];
  if (value === null) {
    // 游标行该列为 NULL：只有同为 NULL 的行可能排在其后
    branches.push({ [keySpec.field]: null, ...deeper });
    return { OR: branches };
  }

  branches.push({ [keySpec.field]: { lt: value } });
  if (keySpec.nullable) {
    // DESC NULLS LAST：NULL 行整体排在所有非空值之后
    branches.push({ [keySpec.field]: null });
  }
  branches.push({ [keySpec.field]: value, ...deeper });
  return { OR: branches };
}

/** 统一的非法游标异常：与游标公共工具同文案，前端按 400 参数类分支处理 */
function invalidClubCursor(): BadRequestException {
  return new BadRequestException(CURSOR_INVALID_MESSAGE);
}
