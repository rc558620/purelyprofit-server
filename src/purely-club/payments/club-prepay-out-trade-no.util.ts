/**
 * 预下单尝试单号：在基准订单号后追加 `-P{2位序号}`。
 *
 * 为什么需要：微信 JSAPI 下单不允许同一个 out_trade_no 重复下单，
 * 而「取支付参数」这一步必须可重试（网络抖动、用户取消后再次拉起）。
 * 于是每次取参都换一个新单号，同时让单号**自带可反解的基准单号**：
 * 支付回调即使拿不到任何映射存储，也能从 out_trade_no 还原出原订单号，
 * Redis 抖动 / 抖动后被清空都不会影响落账。
 *
 * 只对 SV（服务购买单）与 MC（购卡单）启用：这两条链路才由本次改造改为
 * 「建单不预下单」。其余单号（RC / VC / SO / SF）保持原样，已上线链路零影响。
 *
 * ⚠️ 后缀格式必须与 `splitPrepayOutTradeNo` 严格互逆，
 * 且必须落在微信 out_trade_no 允许字符集（数字 / 大小写字母 / `_-|*`）与
 * 长度上限（32）之内：`-P01` 共 4 字符，SV 23 + 4 = 27、MC 22 + 4 = 26。
 */

/** 启用尝试后缀的订单前缀（其余前缀原样返回） */
const PREPAY_SUFFIX_PREFIXES: ReadonlySet<string> = new Set(['SV', 'MC']);

/** 后缀正则：与 buildPrepayOutTradeNo 的输出格式一一对应 */
const PREPAY_SUFFIX_PATTERN = /^(.+)-P(\d{2})$/;

/** 尝试序号位宽：两位，固定 01~99 */
const ATTEMPT_SEQ_WIDTH = 2;

/** 尝试序号上限：超过视为异常重试风暴，由调用方转成业务错误 */
export const MAX_PREPAY_ATTEMPT_SEQ = 99;

/** 前缀长度：订单号前两位即业务类型 */
const ORDER_PREFIX_LENGTH = 2;

/** 构造带尝试序号的 out_trade_no（序号越界时钳到上限，由调用方先做越界校验） */
export function buildPrepayOutTradeNo(
  baseOrderNo: string,
  attemptSeq: number,
): string {
  const seq = Math.min(
    Math.max(Math.trunc(attemptSeq), 1),
    MAX_PREPAY_ATTEMPT_SEQ,
  );
  return `${baseOrderNo}-P${String(seq).padStart(ATTEMPT_SEQ_WIDTH, '0')}`;
}

/** 反解结果：`attemptSeq` 为 null 表示该单号没有尝试后缀（无需改写） */
export interface PrepayOutTradeNoParts {
  /** 基准订单号：用于定位草稿 / 订单 / 落账 */
  baseOrderNo: string;
  /** 尝试序号；无后缀时为 null */
  attemptSeq: number | null;
}

/**
 * 反解 out_trade_no。
 *
 * 只有「已启用后缀的前缀 + 完整匹配 `-Pnn`」才会被剥离，
 * 其余单号原样返回——包括自助下单的 `SF-{orderId}-{payload}` 这类本身含连字符的单号，
 * 避免误伤已上线链路。
 */
export function splitPrepayOutTradeNo(
  outTradeNo: string,
): PrepayOutTradeNoParts {
  const trimmed = outTradeNo.trim();
  if (
    !PREPAY_SUFFIX_PREFIXES.has(
      trimmed.slice(0, ORDER_PREFIX_LENGTH).toUpperCase(),
    )
  ) {
    return { baseOrderNo: trimmed, attemptSeq: null };
  }

  const matched = PREPAY_SUFFIX_PATTERN.exec(trimmed);
  if (!matched) {
    return { baseOrderNo: trimmed, attemptSeq: null };
  }

  return { baseOrderNo: matched[1], attemptSeq: Number(matched[2]) };
}
