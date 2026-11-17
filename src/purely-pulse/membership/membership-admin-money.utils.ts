/**
 * Pulse 会员管理端的金额口径转换。
 *
 * 上行（元字符串 → 分）：运营在管理端填的金额一律是**展示字符串**（与后端下发的
 * `xxxDisplay` 同口径），入库前必须转成分。
 * 下行（分 → 元字符串）：DTO 里的 `xxxDisplay` 一律由后端算好，前端不做乘除。
 *
 * 三个写入/计算入口（设置会员等级、成交价预览、子账号补录）过去各写了一份，
 * 语义稍有出入，改一处容易漏两处，因此收敛到这里。
 */

import { Money } from '../../shared/money.utils';

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

/**
 * 分 → 元展示字符串（去掉无意义的 `.00`）。
 *
 * 与下发给前端的 `xxxDisplay` 完全同口径：管理端只展示，不再自行分转元。
 */
export function formatAdminMemberFenDisplay(fen: number): string {
  return Money.fromDbCents(fen).toFixedOutputYuan().replace(/\.00$/, '');
}

/**
 * 分 → 元展示字符串；null / undefined 原样返回 null。
 *
 * ⚠️ 用 `typeof === 'number'` 而非 `!== null`：审计行 / mock 残行缺列时值为
 * undefined，直接交给金额格式化会渲染出 `NaN`。
 */
export function formatAdminMemberFenDisplayOrNull(
  fen: number | null | undefined,
): string | null {
  return typeof fen === 'number' ? formatAdminMemberFenDisplay(fen) : null;
}

/** 元 → 分，并在超过 `MAX_MEMBERSHIP_AMOUNT_FEN` 时返回 null（视为非法输入） */
function toBoundedFen(yuan: number): number | null {
  const fen = Math.round(yuan * 100);

  return fen > MAX_MEMBERSHIP_AMOUNT_FEN ? null : fen;
}
