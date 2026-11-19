import Decimal from 'decimal.js';

export type DecimalLike = Decimal | { toString(): string };
export type MoneyDbCentsInput = number | DecimalLike;

function parseFiniteNumber(value: number, fieldName: string): Decimal {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${fieldName}必须是有限数字`);
  }

  return new Decimal(value);
}

function parseDecimalLike(
  value: MoneyDbCentsInput,
  fieldName: string,
): Decimal {
  if (typeof value === 'number') {
    return parseFiniteNumber(value, fieldName);
  }

  const decimalValue = new Decimal(value.toString());
  if (!decimalValue.isFinite()) {
    throw new RangeError(`${fieldName}必须是有限数字`);
  }

  return decimalValue;
}

function toSafeInteger(value: Decimal, fieldName: string): number {
  if (!value.isInteger()) {
    throw new RangeError(`${fieldName}必须是整数`);
  }

  const integerValue = value.toNumber();
  if (!Number.isSafeInteger(integerValue)) {
    throw new RangeError(`${fieldName}超出安全整数范围`);
  }

  return integerValue;
}

function roundToCentsFromYuan(yuan: number): number {
  return toSafeInteger(
    parseFiniteNumber(yuan, '前端元金额')
      .mul(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
    '数据库分金额',
  );
}

function assertDbCents(value: MoneyDbCentsInput): number {
  return toSafeInteger(parseDecimalLike(value, '数据库分金额'), '数据库分金额');
}

function roundDecimalToNumber(value: Decimal, precision: number): number {
  return value.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * 严格金额值对象：全仓金额链路只允许使用这一种方法。
 *
 * 设计约束：
 * 1. 内部状态永远存“数据库分金额 Int”；
 * 2. 前端入站只允许 `Money.fromInputYuan()`；
 * 3. 数据库/Prisma/SQL 出站只允许 `Money.fromDbCents()`；
 * 4. 接口响应只允许 `money.toOutputYuan()`；
 * 5. 禁止继续使用裸 `number` 在业务主链路里表达金额语义。
 */
export class Money {
  private constructor(private readonly dbCentsValue: number) {}

  static zero(): Money {
    return new Money(0);
  }

  /**
   * 仅用于前端请求 DTO、表单输入、手工录入的“元”金额。
   */
  static fromInputYuan(yuan: number): Money {
    return new Money(roundToCentsFromYuan(yuan));
  }

  /**
   * 仅用于数据库字段、Prisma 聚合结果、SQL SUM 结果等"分"金额。
   * 若传入非整数分，直接报错，避免把元误当分静默吞掉。
   *
   * ─── 整数快路径 ───────────────────────────────────────────────
   * 数据库 Int 字段与 Prisma SUM(number) 走 `typeof number + isSafeInteger`
   * 直接构造，省掉一次 Decimal 解析。分金额在链路里恒为整数分，
   * 该快路径与原 `assertDbCents` 的校验语义一致：
   * 非整数 / NaN / 超出安全整数范围仍会落到 Decimal 分支并按原文案抛错。
   * 交班页这类按行循环（数千行 × 多次转分）的链路，该分支是主要 CPU 成本。
   */
  static fromDbCents(cents: MoneyDbCentsInput): Money {
    if (typeof cents === 'number' && Number.isSafeInteger(cents)) {
      return new Money(cents);
    }

    return new Money(assertDbCents(cents));
  }

  /**
   * 从纯利豆数量换算为 Money。
   * 业务规则：1 豆 = 1 元 = 100 分。
   * 全仓"豆→金额"换算只允许使用此方法，禁止在业务代码中手写 ×100。
   */
  static fromBeanAmount(beanAmount: MoneyDbCentsInput): Money {
    const cents = parseDecimalLike(beanAmount, '纯利豆数量').mul(100);
    return new Money(
      toSafeInteger(
        cents.toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
        '数据库分金额',
      ),
    );
  }

  /** 返回两个 Money 中较大者 */
  static max(a: Money, b: Money): Money {
    return a.dbCentsValue >= b.dbCentsValue ? a : b;
  }

  /** 返回两个 Money 中较小者 */
  static min(a: Money, b: Money): Money {
    return a.dbCentsValue <= b.dbCentsValue ? a : b;
  }

  static sum(values: Iterable<Money>): Money {
    let totalCents = 0;

    for (const value of values) {
      totalCents += value.dbCentsValue;
    }

    return new Money(totalCents);
  }

  add(other: Money): Money {
    return new Money(this.dbCentsValue + other.dbCentsValue);
  }

  subtract(other: Money): Money {
    return new Money(this.dbCentsValue - other.dbCentsValue);
  }

  /** 减法后下限为零，避免出现负金额 */
  subtractClampedToZero(other: Money): Money {
    return new Money(Math.max(0, this.dbCentsValue - other.dbCentsValue));
  }

  /**
   * 金额 × 乘数。
   *
   * ─── 整数乘数快路径 ───────────────────────────────────────────
   * 商城/交班/空间链路里最常见的乘数是「数量」（数据库 Int，恒为整数）。
   * 整数分 × 整数 = 精确整数，`toDecimalPlaces(0, ROUND_HALF_UP)` 恒等于原值，
   * 因此可直接整数相乘，结果与被替换的 Decimal 计算逐分等价；
   * 仅在乘数非整数或乘积超出安全整数范围时回退 Decimal 路线。
   */
  multiply(multiplier: number): Money {
    if (Number.isSafeInteger(multiplier)) {
      const product = this.dbCentsValue * multiplier;
      if (Number.isSafeInteger(product)) {
        return new Money(product);
      }
    }

    const decimalMultiplier = parseFiniteNumber(multiplier, '金额乘数');

    return new Money(
      toSafeInteger(
        new Decimal(this.dbCentsValue)
          .mul(decimalMultiplier)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
        '数据库分金额',
      ),
    );
  }

  divide(divisor: number): Money {
    const decimalDivisor = parseFiniteNumber(divisor, '金额除数');
    if (decimalDivisor.isZero()) {
      throw new RangeError('金额除数不能为 0');
    }

    return new Money(
      toSafeInteger(
        new Decimal(this.dbCentsValue)
          .div(decimalDivisor)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
        '数据库分金额',
      ),
    );
  }

  /**
   * 乘法后向上取整到分。
   * 适用于"计时费 = 分钟数 / 60 × 时薪"且金额向上取整到分的场景。
   * 内部用 Decimal 运算，避免浮点误差；最终 ceil 到整数分。
   */
  multiplyCeilToCent(multiplier: number): Money {
    const decimalMultiplier = parseFiniteNumber(multiplier, '金额乘数');

    return new Money(
      toSafeInteger(
        new Decimal(this.dbCentsValue)
          .mul(decimalMultiplier)
          .toDecimalPlaces(0, Decimal.ROUND_CEIL),
        '数据库分金额',
      ),
    );
  }

  /**
   * 按金额和单价换算出可购买的完整单位数，向下取整。
   * 适用于"续费分钟数 = 金额 / 时薪 × 60"且向下取整到分钟的场景。
   * 返回整数，至少为 0。
   */
  calcWholeUnitsFloor(unitPrice: Money, unitSize: number): number {
    if (unitPrice.isZero() || unitPrice.isNegative()) {
      return 0;
    }
    if (unitSize <= 0) {
      return 0;
    }
    if (this.isZero() || this.isNegative()) {
      return 0;
    }

    const decimalUnitSize = parseFiniteNumber(unitSize, '单位大小');
    const result = new Decimal(this.dbCentsValue)
      .div(unitPrice.dbCentsValue)
      .mul(decimalUnitSize)
      .toDecimalPlaces(0, Decimal.ROUND_FLOOR);

    const units = result.toNumber();
    return Math.max(0, units);
  }

  abs(): Money {
    return new Money(Math.abs(this.dbCentsValue));
  }

  negate(): Money {
    return new Money(-this.dbCentsValue);
  }

  compare(other: Money): number {
    return this.dbCentsValue - other.dbCentsValue;
  }

  equals(other: Money): boolean {
    return this.dbCentsValue === other.dbCentsValue;
  }

  greaterThan(other: Money): boolean {
    return this.dbCentsValue > other.dbCentsValue;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.dbCentsValue >= other.dbCentsValue;
  }

  lessThan(other: Money): boolean {
    return this.dbCentsValue < other.dbCentsValue;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.dbCentsValue <= other.dbCentsValue;
  }

  isZero(): boolean {
    return this.dbCentsValue === 0;
  }

  isPositive(): boolean {
    return this.dbCentsValue > 0;
  }

  isNegative(): boolean {
    return this.dbCentsValue < 0;
  }

  /**
   * 仅用于数据库写入、缓存存储、内部断言，不允许直接返回给前端。
   */
  toDbCents(): number {
    return this.dbCentsValue;
  }

  /**
   * 仅用于接口响应、页面展示、日志输出。
   *
   * 内部状态是整数分，÷100 后最多两位小数，`toDecimalPlaces(2)` 恒为无操作，
   * 因此直接做双精度除法即可得到与「Decimal 精确除法 → toNumber」完全一致的数值，
   * 省掉每次输出的 Decimal 构造与舍入。需要定长字符串时仍走 toFixedOutputYuan。
   */
  toOutputYuan(): number {
    return this.dbCentsValue / 100;
  }

  toFixedOutputYuan(): string {
    return new Decimal(this.dbCentsValue).div(100).toFixed(2);
  }
}

export function calcPercentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return null;
  }

  return roundDecimalToNumber(
    new Decimal(current).minus(previous).div(previous).mul(100),
    2,
  );
}

/**
 * 利润环比的业务口径。
 *
 * - `normal`：上期为非负，普通增长率（正 = 变好）；
 * - `reduced_loss`：上期为亏、本期仍亏但亏得更少（减亏）；
 * - `worsened_loss`：上期为亏、本期亏得更多（增亏）；
 * - `turned_profit`：上期为亏、本期转盈（扭亏）。
 */
export type ProfitCompareType =
  | 'normal'
  | 'reduced_loss'
  | 'worsened_loss'
  | 'turned_profit';

export interface ProfitCompareResult {
  percent: number | null;
  type: ProfitCompareType | null;
}

/**
 * 净利润环比：上期为负（亏损）时不能直接用「当前 / 上期」的普通增长率。
 *
 * 普通公式在负基期下方向会反：上期亏 100、本期亏 50 会算出 −50%（显示为下降），
 * 亏到 200 反而算出 +100%（显示为上升）。这里改为按「亏损额的绝对值」做分母，
 * 让百分比符号始终表示「变好 / 变差」，并由 type 交给前端显示减亏 / 增亏 / 扭亏。
 * 上期为 0 时依旧无法计算，返回 null。
 */
export function calcProfitCompare(
  current: number,
  previous: number,
): ProfitCompareResult {
  if (previous === 0) {
    return { percent: null, type: null };
  }

  if (previous > 0) {
    return { percent: calcPercentChange(current, previous), type: 'normal' };
  }

  const percent = roundDecimalToNumber(
    new Decimal(current).minus(previous).div(Math.abs(previous)).mul(100),
    2,
  );

  if (current >= 0) {
    return { percent, type: 'turned_profit' };
  }

  if (current > previous) {
    return { percent, type: 'reduced_loss' };
  }

  if (current < previous) {
    return { percent, type: 'worsened_loss' };
  }

  return { percent, type: 'normal' };
}

export function calcPercentOfTotal(amount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return roundDecimalToNumber(new Decimal(amount).div(total).mul(100), 2);
}

export function calcRatioPercent(
  numerator: number,
  denominator: number,
  precision = 2,
): number {
  if (denominator <= 0) {
    return 0;
  }

  return roundDecimalToNumber(
    new Decimal(numerator).div(denominator).mul(100),
    precision,
  );
}

/**
 * 计算两个百分率之间的百分点差值（如利润率从 30% 变为 40%，差值为 10）。
 * 适用于 profitRate、costRate 等本身已是百分比的表达式的变化量。
 * 不适用于金额环比变化率（金额环比应使用 calcPercentChange）。
 */
export function calcPercentPointDiff(
  currentPercent: number,
  previousPercent: number,
): number {
  return roundDecimalToNumber(
    new Decimal(currentPercent).minus(previousPercent),
    2,
  );
}

export function calcPercentChangeWithFallback(
  current: number,
  previous: number,
  options?: {
    fallback?: number | null;
    absoluteBase?: boolean;
    precision?: number;
  },
): number | null {
  const fallback = options?.fallback ?? null;
  const precision = options?.precision ?? 1;
  const base = options?.absoluteBase ? Math.abs(previous) : previous;

  if (base === 0) {
    return fallback;
  }

  return roundDecimalToNumber(
    new Decimal(current - previous).div(base).mul(100),
    precision,
  );
}

/**
 * 计算两个 Money 的比值（收入/支出 = 1.23x），保留两位小数。
 * 适用于收支比等"金额 A / 金额 B"场景，分母为 0 时返回 null。
 * 所有金额运算统一走 Money（分），最终结果统一 Decimal 四舍五入。
 */
export function calcMoneyRatio(
  numerator: Money,
  denominator: Money,
): number | null {
  if (denominator.isZero()) {
    return null;
  }

  return roundDecimalToNumber(
    new Decimal(numerator.toDbCents()).div(denominator.toDbCents()),
    2,
  );
}
