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
   * 仅用于数据库字段、Prisma 聚合结果、SQL SUM 结果等“分”金额。
   * 若传入非整数分，直接报错，避免把元误当分静默吞掉。
   */
  static fromDbCents(cents: MoneyDbCentsInput): Money {
    return new Money(assertDbCents(cents));
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

  multiply(multiplier: number): Money {
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
   */
  toOutputYuan(): number {
    return roundDecimalToNumber(new Decimal(this.dbCentsValue).div(100), 2);
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
