/**
 * Pulse 会员管理端的「元字符串 → 分」解析。
 *
 * 运营在管理端填的金额一律是**展示字符串**（与后端下发的 `xxxDisplay` 同口径），
 * 后端入库前必须转成分。三个写入/计算入口（设置会员等级、成交价预览、子账号补录）
 * 过去各写了一份，语义稍有出入，改一处容易漏两处，因此收敛到这里。
 */

/**
 * 金额上限（分）= 100 万元。
 *
 * 会员成交 / 续费价不可能到这个量级，超出一律按「误输入」拒绝。
 *
 * 必须有这道护栏：库里 `price` / `renewal_price_override` / `sub_account_amount`
 * 都是 PG `integer`（上限 2147483647 分），而 `Math.round(元 * 100)` 没有上限。
 * 少了它，运营填一串长数字会让 Prisma 抛「value out of range」→ 变成 500，
 * 本该是一条可读的 400 参数错误。
 */
export const MAX_MEMBERSHIP_AMOUNT_FEN = 100_000_000;

/**
 * 成交价展示值（元字符串）→ 分；缺失或非法时返回 null。
 *
 * 与 `resolveAmountFen` 的差别是**不允许 0**：0 元成交价不是有效输入，
 * 「免费会员」是一个独立档位，不该靠把成交价填 0 来表达。
 */
export function resolvePriceFen(display?: string | null): number | null {
  if (typeof display !== 'string' || display.trim() === '') {
    return null;
  }

  const parsedValue = Number.parseFloat(display.trim());
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return toBoundedFen(parsedValue);
}

/**
 * 金额展示值（元字符串）→ 分；缺失或非法时返回 null。
 *
 * 与 `resolvePriceFen` 的差别是**允许 0**：子账号加价填 0 是有效且有意义的取值
 * ——「这家店的会员不收子账号的钱」，与「运营还没录入」是两回事，
 * 后者在库里表现为 NULL。
 */
export function resolveAmountFen(display?: string | null): number | null {
  if (typeof display !== 'string' || display.trim() === '') {
    return null;
  }

  const parsedValue = Number.parseFloat(display.trim());
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return toBoundedFen(parsedValue);
}

/** 元 → 分，并在超过 `MAX_MEMBERSHIP_AMOUNT_FEN` 时返回 null（视为非法输入） */
function toBoundedFen(yuan: number): number | null {
  const fen = Math.round(yuan * 100);

  return fen > MAX_MEMBERSHIP_AMOUNT_FEN ? null : fen;
}
