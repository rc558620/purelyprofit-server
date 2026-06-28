/**
 * 解析折扣率（支持 discountRate / rate 两种字段格式）
 *
 * - discountRate：0-100 的数值（如 75 表示 7.5 折）
 * - rate：0-1 的小数（如 0.75 表示 7.5 折），自动转换为 0-100
 *
 * @returns 0-100 的折扣率数值，或 null（无效输入）
 */
export function parseDiscountRate(
  params: Record<string, unknown>,
): number | null {
  const rawDiscountRate = params.discountRate;
  const rawRate = params.rate;

  let discountRate: number | null = null;

  if (rawDiscountRate !== null && rawDiscountRate !== undefined) {
    const parsed = Number(rawDiscountRate);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 100) {
      discountRate = parsed;
    }
  }

  if (discountRate === null && rawRate !== null && rawRate !== undefined) {
    const parsed = Number(rawRate);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
      discountRate = parsed * 100;
    }
  }

  return discountRate;
}
