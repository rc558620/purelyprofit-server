// Pulse / 管理端会员请求参数的归一化函数
//
// 前端弹窗清空输入框会传空串、勾选框会传字符串，而 @IsOptional 只跳过
// null / undefined —— 统一在这里把「没填」归一成 undefined，由 @IsOptional 放行；
// 「填了但非法」的值原样留下，交给 @IsInt / @Matches 报 400。

export function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === '') {
    return undefined;
  }
  return Number(value);
}

export function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return undefined;
}

/**
 * 数字入参：null / undefined / 空串 → undefined，其余转数字。
 *
 * 转不成数字的情况（如 'abc'）保留 NaN，交给后面的 @IsInt 统一报 400，
 * 别在这里抛异常把 400 变成 500。
 */
export function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Number(value);
}

/**
 * 金额字符串：trim 后为空 → undefined。
 *
 * @IsOptional 只跳过 null / undefined，空串会落到 @Matches 被判非法 → 400，
 * 「清除覆盖 / 撤销补录」这类「传空即回退」的语义就永远提交不了，
 * 所以统一在这里把空串归一成 undefined。非字符串原样返回，交给 @IsString 拦。
 */
export function toOptionalAmountString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}
