// 列表游标分页公共能力：统一编码格式、严格解码与每页条数归一（纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';

/**
 * 游标载荷：排序键值 + 唯一主键。
 *
 * `keys` 的顺序必须与查询 `orderBy` 的排序键顺序完全一致，且必须以 `id` 兜底：
 * 只编码时间戳时，同一时刻写入的多行会互相挤占位置，翻页必然漏读或重复读。
 */
export interface CursorPayload {
  /** 排序键值（时间用毫秒数表示，避免时区与序列化歧义） */
  keys: Array<string | number>;
  /** 唯一主键，作为最后一级 tie-breaker */
  id: number;
}

/** 每页条数归一参数 */
export interface CursorLimitOptions {
  /** 未传 limit 时的默认条数 */
  defaultLimit: number;
  /** 单页硬上限：沿用接口原有 pageSize 上限，不因迁移放大 */
  maxLimit: number;
}

/** 非法游标统一提示（错误码归入参数类，前端可按 400 分支处理） */
export const CURSOR_INVALID_MESSAGE = 'cursor 格式不合法';

/**
 * 游标版本前缀。
 *
 * 编码格式升级（例如排序键从单字段变成复合键）时可并存 `v2:`，前端始终把
 * 游标当不透明字符串原样回传，无需感知版本切换。
 */
const CURSOR_VERSION_PREFIX = 'v1:';

/** 游标长度上限：正常载荷 20~80 字符，超长即视为构造异常，尽早拒绝 */
const CURSOR_MAX_LENGTH = 256;

/** 载荷最多承载的排序键数：超出说明客户端传了不属于本接口的游标 */
const CURSOR_MAX_KEYS = 4;

/** 编码游标：`v1:` + base64url(JSON)，前端原样回传即可 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ keys: payload.keys, id: payload.id });
  return `${CURSOR_VERSION_PREFIX}${Buffer.from(json, 'utf8').toString(
    'base64url',
  )}`;
}

/**
 * 解码游标。
 *
 * @returns 空串 / null / undefined 一律视为「第一页」返回 null。
 * @throws BadRequestException 格式非法时抛 400：
 *         静默降级成第一页会让无限滚动把首屏重复插入列表，用户只能刷新自救，
 *         问题被藏起来反而更难排查。
 */
export function decodeCursor(raw?: string | null): CursorPayload | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (
    value.length > CURSOR_MAX_LENGTH ||
    !value.startsWith(CURSOR_VERSION_PREFIX)
  ) {
    throw invalidCursorError();
  }

  const encoded = value.slice(CURSOR_VERSION_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    // base64 被截断或非 JSON：只能是被改写过的游标，按参数错误拒绝
    throw invalidCursorError();
  }

  return normalizeCursorPayload(parsed);
}

/**
 * 每页条数归一：缺省取默认值，非数值回退默认值，超上限钳到上限。
 *
 * 上限必须沿用接口原有 pageSize 上限：三端「静默刷新按已加载条数重拉」的实现
 * 依赖这个硬上限，迁移期放大上限会让这些页面一次性拉爆。
 */
export function resolveCursorLimit(
  limit: number | undefined,
  options: CursorLimitOptions,
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return options.defaultLimit;
  }
  return Math.min(
    Math.max(Math.trunc(limit), 1),
    Math.max(options.maxLimit, 1),
  );
}

/** 校验并归一 JSON 载荷：只接受 `{ keys: (string|number)[], id: number }` */
function normalizeCursorPayload(parsed: unknown): CursorPayload {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidCursorError();
  }

  const { keys, id } = parsed as { keys?: unknown; id?: unknown };
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > CURSOR_MAX_KEYS
  ) {
    throw invalidCursorError();
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw invalidCursorError();
  }

  const normalizedKeys = keys.map((key: unknown): string | number => {
    if (typeof key === 'string') {
      return key;
    }
    if (typeof key === 'number' && Number.isSafeInteger(key)) {
      return key;
    }
    throw invalidCursorError();
  });

  return { keys: normalizedKeys, id };
}

/** 构造统一的非法游标异常（避免异常对象在多处重复拼装） */
function invalidCursorError(): BadRequestException {
  return new BadRequestException(CURSOR_INVALID_MESSAGE);
}
