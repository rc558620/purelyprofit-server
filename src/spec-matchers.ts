/**
 * 严格化测试断言用的非对称匹配器集合。
 *
 * 用于替换宽松的类型占位断言：
 * - 对可推导的值，测试中应优先使用精确值；
 * - 对确实动态生成、无法在断言点拿到精确值的字段（进程指标、耗时、锁 token、邀请码等），
 *   使用下面的匹配器做「格式/约束断言」，比宽松类型占位更严格，
 *   能拦截空串、NaN、负数、非法格式、Invalid Date、空集合等问题。
 *
 * 这些对象实现了 Jest 的 AsymmetricMatcher 接口（含 `$$typeof` 标识），
 * 可直接用于 `expect(...).toEqual/toMatchObject/toHaveBeenCalledWith` 的嵌套字段中。
 */

const JEST_ASYMMETRIC_MATCHER = Symbol.for('jest.asymmetricMatcher');

/**
 * 统一构造非对称匹配器，并补齐 Jest 打印接口。
 *
 * 缺少 `toAsymmetricMatcher()` 时，一旦断言失败，Jest 在序列化期望值阶段会抛出
 * 「Asymmetric matcher Object does not implement toAsymmetricMatcher()」，
 * 把真实的不匹配信息掩盖掉。此处统一补齐，保证失败时能看到真实差异。
 */
const defineMatcher = <
  T extends { asymmetricMatch: (actual: unknown) => boolean },
>(
  matcher: T,
  label: string,
): T & { $$typeof: symbol; toAsymmetricMatcher: () => string } => ({
  ...matcher,
  $$typeof: JEST_ASYMMETRIC_MATCHER,
  toAsymmetricMatcher: (): string => label,
});

/** 非负有限数字：拒绝 NaN / Infinity / 负数 / 非数字。 */
export const aNonNegativeNumber = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'number' && Number.isFinite(actual) && actual >= 0,
    toString: (): string => 'aNonNegativeNumber(>=0 finite number)',
  },
  'aNonNegativeNumber(>=0 finite number)',
);

/** 非空字符串：拒绝空串与非字符串。 */
export const aNonEmptyString = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'string' && actual.length > 0,
    toString: (): string => 'aNonEmptyString(non-empty string)',
  },
  'aNonEmptyString(non-empty string)',
);

/** UUID v4 格式字符串。 */
export const aUuid = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        actual,
      ),
    toString: (): string => 'aUuid(UUID string)',
  },
  'aUuid(UUID string)',
);

/** 门店邀请码：8 位，字符集 23456789ABCDEFGHJKLMNPQRSTUVWXYZ。 */
export const anInviteCode = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'string' &&
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(actual),
    toString: (): string => 'anInviteCode(8-char store invite code)',
  },
  'anInviteCode(8-char store invite code)',
);

/** 合法 Date 实例：拒绝 Invalid Date（如 new Date('')）。 */
export const aValidDate = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      actual instanceof Date && !Number.isNaN(actual.getTime()),
    toString: (): string => 'aValidDate(valid Date instance)',
  },
  'aValidDate(valid Date instance)',
);

/** 非空普通对象（非 null、非数组、非 Date、且至少有一个自有属性）。 */
export const aNonEmptyObject = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'object' &&
      actual !== null &&
      !Array.isArray(actual) &&
      !(actual instanceof Date) &&
      Object.keys(actual as object).length > 0,
    toString: (): string => 'aNonEmptyObject(non-empty plain object)',
  },
  'aNonEmptyObject(non-empty plain object)',
);

/** 非空数组：至少包含一个元素。 */
export const aNonEmptyArray = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      Array.isArray(actual) && actual.length > 0,
    toString: (): string => 'aNonEmptyArray(non-empty array)',
  },
  'aNonEmptyArray(non-empty array)',
);

/** 非空 Set：至少包含一个元素。 */
export const aNonEmptySet = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean =>
      actual instanceof Set && actual.size > 0,
    toString: (): string => 'aNonEmptySet(non-empty Set)',
  },
  'aNonEmptySet(non-empty Set)',
);

/**
 * 合法 Date 或「非空普通对象」二选一。
 * 用于原本用宽松对象占位、但取值既可能是 Date 实例、也可能是范围对象
 * （如 `{ gte, lte }`）的模糊字段，比宽松对象占位更严格
 * （拒绝 null / 数组 / 空对象 / Invalid Date），且对两种形态都安全。
 */
export const aDateOrObject = defineMatcher(
  {
    asymmetricMatch: (actual: unknown): boolean => {
      if (actual instanceof Date) {
        return !Number.isNaN(actual.getTime());
      }
      return (
        typeof actual === 'object' &&
        actual !== null &&
        !Array.isArray(actual) &&
        Object.keys(actual as object).length > 0
      );
    },
    toString: (): string =>
      'aDateOrObject(valid Date | non-empty plain object)',
  },
  'aDateOrObject(valid Date | non-empty plain object)',
);
