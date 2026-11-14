/**
 * C 端业务错误码的域无关基础设施。
 *
 * 全局 AllExceptionsFilter 会把 HttpException.getResponse() 里的 code 原样
 * 透传到响应体，前端按 code 分支、不按中文文案匹配。因此码值一旦发布不得修改，
 * 新增场景只能追加码值。
 *
 * 码值约定：CLUB_<域>_<分类>_<场景>，分类段取值见 CLUB_ERROR_CODE_CLASS。
 * 各域只维护自己的码表（如 recharge/club-recharge.errors.ts），用本文件的
 * clubBusinessError 组装载荷，避免每个域各自复制一套类型与构造器。
 *
 * 载荷必须保留 message 字段：NestJS HttpException 用它设置 Error.message，
 * 全局过滤器也只从 message 取展示文案。丢掉它会让按文案兜底的旧前端、
 * 以及现有 toThrow('中文文案') 断言集体失效。
 *
 * message 一律由调用方显式传入，不做 code→文案映射：动态文案（余额不足需带金额）
 * 无法集中映射，集中化还会制造第二个文案事实源。
 */
export const CLUB_ERROR_CODE_CLASS = {
  /** 参数非法 */
  PARAM: 'PARAM',
  /** 鉴权失败 */
  AUTH: 'AUTH',
  /** 资源不存在 */
  RESOURCE: 'RESOURCE',
  /** 状态冲突：状态机拒绝 / 并发抢占 */
  STATUS: 'STATUS',
  /** 业务规则拒绝：过期、库存、余额、限购、业态 */
  RULE: 'RULE',
  /** 依赖失败：三方接口、券码生成等 */
  DEPENDENCY: 'DEPENDENCY',
  /** 系统异常 */
  SYSTEM: 'SYSTEM',
} as const;

export type ClubErrorCodeClass =
  (typeof CLUB_ERROR_CODE_CLASS)[keyof typeof CLUB_ERROR_CODE_CLASS];

/** 携带稳定业务码的异常载荷；C 由各域码表的字面量联合收窄 */
export interface ClubBusinessErrorPayload<C extends string = string> {
  code: C;
  message: string;
}

/** 构造业务异常载荷，交给 NestJS 的 HttpException 子类使用 */
export function clubBusinessError<C extends string>(
  code: C,
  message: string,
): ClubBusinessErrorPayload<C> {
  return { code, message };
}

/**
 * 校验域码表是否符合命名约定，供各域 errors.spec.ts 复用：
 * 值唯一、带本域前缀、分类段合法。返回问题描述列表，空数组表示合规。
 */
export function inspectClubErrorCodeTable(
  codes: Record<string, string>,
  domainPrefix: string,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const allowedClasses: ReadonlySet<string> = new Set<string>(
    Object.values(CLUB_ERROR_CODE_CLASS),
  );

  for (const [key, value] of Object.entries(codes)) {
    if (!value.startsWith(domainPrefix)) {
      problems.push(`${key} 缺少前缀 ${domainPrefix}`);
      continue;
    }
    if (seen.has(value)) {
      problems.push(`${key} 码值重复：${value}`);
    }
    seen.add(value);

    const classSegment = value.slice(domainPrefix.length).split('_')[0];
    if (!allowedClasses.has(classSegment)) {
      problems.push(`${key} 分类段 ${classSegment} 不合法`);
    }
  }

  return problems;
}

/**
 * 冻结的历史业务码（早于 `CLUB_<域>_<分类>_` 规范，前端已按字面量分支）。
 *
 * ⚠️ 这五个值都是跨仓库契约，禁止改名或「顺手规范化」：
 * `NO_ACCESSIBLE_STORE` 尤其关键，purelyClub 的 NO_ACCESSIBLE_STORE_BIZ_CODE
 * 依赖它执行「清缓存 + 跳选店页」兜底，改值会让多门店用户卡在错误页。
 *
 * 新增场景一律用新规范码，不要往这张表追加。
 * 外部模块的历史码（NEW_CUSTOMER_QUOTA_EXHAUSTED、MEMBERSHIP_EXPIRED）由
 * purely-profit 各自模块拥有，本清单不重复定义，避免出现第二个事实源。
 */
export const CLUB_LEGACY_ERROR_CODE = {
  NO_ACCESSIBLE_STORE: 'NO_ACCESSIBLE_STORE',
  STORE_PAY_CONFIG_MISSING: 'STORE_PAY_CONFIG_MISSING',
  CHECK_IN_ALREADY_DONE: 'CHECK_IN_ALREADY_DONE',
  CHECK_IN_ACTIVITY_NOT_ACTIVE: 'CHECK_IN_ACTIVITY_NOT_ACTIVE',
  CHECK_IN_ACTIVITY_NOT_FOUND: 'CHECK_IN_ACTIVITY_NOT_FOUND',
} as const;

export type ClubLegacyErrorCode =
  (typeof CLUB_LEGACY_ERROR_CODE)[keyof typeof CLUB_LEGACY_ERROR_CODE];

/**
 * 校验各域导出的历史码值仍在冻结清单内，防止有人改值而悄悄破坏前端兜底。
 * `actual` 的键名由各域自定，只比对码值。
 */
export function inspectFrozenErrorCodeValues(
  actual: Record<string, string>,
  frozen: Record<string, string>,
): string[] {
  const frozenValues = new Set<string>(Object.values(frozen));
  const problems: string[] = [];

  for (const [key, value] of Object.entries(actual)) {
    if (!frozenValues.has(value)) {
      problems.push(`${key} 的值 ${value} 不在冻结清单内`);
    }
  }
  if (frozenValues.size !== Object.keys(frozen).length) {
    problems.push('冻结清单内出现重复码值');
  }

  return problems;
}
