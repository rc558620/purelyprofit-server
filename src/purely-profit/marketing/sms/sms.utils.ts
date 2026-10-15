import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Money } from '../../../shared/money.utils';
import { normalizePhone } from '../marketing.utils';
import {
  SMS_ORDER_NO_PREFIX,
  SMS_RECHARGE_TIERS_FEN_DEFAULT,
  SMS_SEGMENT_COUNT_MODE_DEFAULT,
  SMS_SEGMENT_LONG_LIMIT_DEFAULT,
  SMS_SEGMENT_SINGLE_LIMIT_DEFAULT,
  SMS_UNIT_PRICE_FEN_DEFAULT,
  SMS_WARNING_THRESHOLD_FEN_DEFAULT,
  type SmsSegmentCountMode,
} from './sms.constants';

export interface SmsSegmentLimits {
  singleLimit: number;
  longLimit: number;
}

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

/** 从配置读取正整数，非法值回落兜底值（避免 env 写错把单价变成 0 / NaN） */
function resolvePositiveInt(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const value = configService.get<number>(key);
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function resolveSmsUnitPriceFen(configService: ConfigService): number {
  return resolvePositiveInt(
    configService,
    'sms.unitPriceFen',
    SMS_UNIT_PRICE_FEN_DEFAULT,
  );
}

export function resolveSmsWarningThresholdFen(
  configService: ConfigService,
): number {
  return resolvePositiveInt(
    configService,
    'sms.warningThresholdFen',
    SMS_WARNING_THRESHOLD_FEN_DEFAULT,
  );
}

/**
 * 读取计费字数统计口径。
 *
 * 询价与扣费**必须走同一个值**：两边各读一次配置、或者一个读了一个没读，
 * 都会出现「询价 100 条、扣款 120 条」这种金额漂移。
 */
export function resolveSmsSegmentCountMode(
  configService: ConfigService,
): SmsSegmentCountMode {
  return configService.get<string>('sms.segmentCountMode') === 'codepoint'
    ? 'codepoint'
    : SMS_SEGMENT_COUNT_MODE_DEFAULT;
}

/**
 * 读取平台短信采购成本（分/条）。
 *
 * 0 表示未配置（不做毛利监控）。填上真实采购价后，售价低于成本时每次群发会告警，
 * 用来发现「发得越多亏得越多」的倒挂。
 */
export function resolveSmsCostPriceFen(configService: ConfigService): number {
  const value = configService.get<number>('sms.costPriceFen');
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function resolveSmsSegmentLimits(
  configService: ConfigService,
): SmsSegmentLimits {
  return {
    singleLimit: resolvePositiveInt(
      configService,
      'sms.segmentSingleLimit',
      SMS_SEGMENT_SINGLE_LIMIT_DEFAULT,
    ),
    longLimit: resolvePositiveInt(
      configService,
      'sms.segmentLongLimit',
      SMS_SEGMENT_LONG_LIMIT_DEFAULT,
    ),
  };
}

/** 充值档位（分）。配置为空或非法时回落兜底档位。 */
export function resolveSmsRechargeTiersFen(
  configService: ConfigService,
): number[] {
  const configured = configService.get<number[]>('sms.rechargeTiersFen');
  const valid = Array.isArray(configured)
    ? configured.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value) && value > 0,
      )
    : [];

  return valid.length > 0 ? valid : [...SMS_RECHARGE_TIERS_FEN_DEFAULT];
}

/**
 * 是否开启「本地直充」（跳过微信支付直接入账）。
 *
 * 只认显式 `true`，其它一切取值（含 `'1'` / `1` / 未配置）都按 false 处理：
 * 这个开关一旦被误开就是白送钱，宁可保守。
 */
export function resolveSmsDirectCredit(configService: ConfigService): boolean {
  return configService.get<boolean>('sms.directCredit') === true;
}

/** 金额（分）→ 前端展示文案，如 1000 → "¥10" */
export function formatFenAmountDisplay(fen: number): string {
  return `¥${Money.fromDbCents(fen).toOutputYuan()}`;
}

/**
 * 统计短信正文字数。
 *
 * 两种口径（由 `sms.segmentCountMode` 切换，默认 `codepoint`）：
 * - `codepoint`：Unicode 码点数，emoji 记 1 字
 * - `utf16`：UTF-16 码元数，emoji 记 2 字
 *
 * 腾讯云按 UCS-2（即 utf16）计费，理论上应当用它；
 * 但切换会改变每一条短信的扣费金额，**属于资金行为变更**，
 * 因此默认维持 codepoint，先靠 {@link countSmsContentUnitsDiff} 的差异日志观测，
 * 用真实数据验证后再通过配置切换。
 */
export function countSmsContentUnits(
  content: string,
  mode: SmsSegmentCountMode = SMS_SEGMENT_COUNT_MODE_DEFAULT,
): number {
  return mode === 'utf16' ? content.length : Array.from(content).length;
}

/**
 * 单条短信被拆成几段（每人分段数）。
 *
 * 规则：`<= singleLimit` 记 1 条，超出按 `ceil(len / longLimit)`。
 */
export function calcSegmentsPerRecipient(
  content: string,
  limits: SmsSegmentLimits,
  mode: SmsSegmentCountMode = SMS_SEGMENT_COUNT_MODE_DEFAULT,
): number {
  const length = countSmsContentUnits(content, mode);
  if (length <= limits.singleLimit) {
    return 1;
  }
  return Math.ceil(length / limits.longLimit);
}

/**
 * 两种计费口径的分段差额（> 0 表示 utf16 口径下应该多收的条数）。
 *
 * 纯粹用于**观测**：本地按 codepoint 计费与腾讯云 UCS-2 计费之间存在系统性
 * 偏差（含 emoji / 生僻字时更明显）。先记录差异量级，确认后再决定是否切换口径，
 * 避免拍脑袋改公式导致多扣商户的钱。
 */
export function countSmsSegmentDiff(
  content: string,
  limits: SmsSegmentLimits,
): number {
  return (
    calcSegmentsPerRecipient(content, limits, 'utf16') -
    calcSegmentsPerRecipient(content, limits, 'codepoint')
  );
}

/**
 * 计费总条数 = 每人分段数 × 有效收件人数。
 *
 * ⚠️ 这是**总条数**而不是「每人分几段」。前端 mock 的口径一致：
 * `estimatedAmountFen = smsSegments × unitPriceFen`。
 * 写成每人分段数会让金额差 N 倍（收件人数倍）。
 */
export function calcSmsSegments(
  content: string,
  validMobileCount: number,
  limits: SmsSegmentLimits,
  mode: SmsSegmentCountMode = SMS_SEGMENT_COUNT_MODE_DEFAULT,
): number {
  if (validMobileCount <= 0) {
    return 0;
  }
  return calcSegmentsPerRecipient(content, limits, mode) * validMobileCount;
}

/** 短信充值订单号：`SM` + 上海时区时间戳 + 随机 HEX（与 club 的 RC/SV 前缀互斥）*/
export function buildSmsOrderNo(now: number = Date.now()): string {
  const shanghai = new Date(now + 8 * 60 * 60_000);
  const serial = [
    shanghai.getUTCFullYear(),
    pad(shanghai.getUTCMonth() + 1),
    pad(shanghai.getUTCDate()),
    pad(shanghai.getUTCHours()),
    pad(shanghai.getUTCMinutes()),
    pad(shanghai.getUTCSeconds()),
    pad(shanghai.getUTCMilliseconds(), 3),
    randomBytes(2).toString('hex').toUpperCase(),
  ].join('');

  return `${SMS_ORDER_NO_PREFIX}${serial}`;
}

const MAINLAND_MOBILE_PATTERN = /^1[3-9]\d{9}$/;

/**
 * 归一化短信收件手机号。
 *
 * 比 marketing.utils 的 normalizePhone 更严格：额外校验 `1[3-9]` 号段，
 * 因为腾讯云对非手机号段（如 10 位固话、12 位以上号码）会整批拒绝。
 * 无法归一化为境内手机号时返回 null，由调用方剔除并计入 invalidCount。
 */
export function normalizeSmsMobile(
  phone: string | null | undefined,
): string | null {
  const digits = normalizePhone(phone);
  if (!digits) {
    return null;
  }
  return MAINLAND_MOBILE_PATTERN.test(digits) ? digits : null;
}

/**
 * 转 E.164 格式（腾讯云 SendSms 要求 `+8613xxxxxxxx`）。
 *
 * 境内境外不可混发：本函数只对境内号生效，非境内号应先用
 * {@link normalizeSmsMobile} 剔除，不要走到这里。
 */
export function toE164MainlandMobile(mobile: string): string {
  return `+86${mobile}`;
}

export function buildSmsQuoteCacheKey(quoteId: string): string {
  return `sms:quote:${quoteId}`;
}

/** 生成对外暴露的群发业务 ID */
export function buildSmsBroadcastId(): string {
  return `bc_${randomBytes(9).toString('hex')}`;
}

/** 生成询价单 ID */
export function buildSmsQuoteId(): string {
  return `qt_${randomBytes(9).toString('hex')}`;
}
