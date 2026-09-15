import {
  BUSINESS_EVENT_PROPERTY_KEY_MAX_LENGTH,
  type BusinessEventReportDto,
} from './dto/business-event-report.dto';

/** 单个事件最多保留的属性个数，防止前端上报超大对象打爆日志 */
export const BUSINESS_EVENT_MAX_PROPERTIES = 20;
/** 单个属性值序列化后的最大长度 */
export const BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH = 120;

export interface BusinessEventLogEntry {
  kind: 'business-event';
  eventId: string;
  name: string;
  occurredAt: string;
  pathname: string;
  planTier?: string;
  storeId?: number;
  appMode?: string;
  appRelease?: string;
  properties: Record<string, string | number | boolean>;
}

/**
 * 归一化属性值。
 *
 * 只保留可聚合的原始类型：
 * - string 截断、number/boolean 原样；
 * - null / undefined 丢弃（避免日志里出现大量无用 key）；
 * - 嵌套对象与数组整体丢弃（需要它们说明该事件设计得不合理，而不是让日志系统扛）。
 */
const normalizePropertyValue = (
  value: unknown,
): string | number | boolean | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH
      ? value.slice(0, BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH)
      : value;
  }

  return undefined;
};

/** 裁剪属性：限制 key 数量与长度，丢弃不可聚合的值 */
export const normalizeBusinessEventProperties = (
  properties: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> => {
  if (!properties || typeof properties !== 'object') {
    return {};
  }

  const normalized: Record<string, string | number | boolean> = {};
  let acceptedCount = 0;

  for (const [rawKey, rawValue] of Object.entries(properties)) {
    if (acceptedCount >= BUSINESS_EVENT_MAX_PROPERTIES) {
      break;
    }

    const key =
      rawKey.length > BUSINESS_EVENT_PROPERTY_KEY_MAX_LENGTH
        ? rawKey.slice(0, BUSINESS_EVENT_PROPERTY_KEY_MAX_LENGTH)
        : rawKey;
    const value = normalizePropertyValue(rawValue);

    if (value === undefined) {
      continue;
    }

    normalized[key] = value;
    acceptedCount += 1;
  }

  return normalized;
};

/** 组装结构化业务事件日志 */
export const buildBusinessEventLog = (
  payload: BusinessEventReportDto,
): BusinessEventLogEntry => {
  const entry: BusinessEventLogEntry = {
    kind: 'business-event',
    eventId: payload.eventId,
    name: payload.name,
    occurredAt: payload.occurredAt,
    pathname: payload.pathname,
    properties: normalizeBusinessEventProperties(payload.properties),
  };

  if (payload.planTier) {
    entry.planTier = payload.planTier;
  }

  if (typeof payload.store?.id === 'number') {
    entry.storeId = payload.store.id;
  }

  if (payload.app?.mode) {
    entry.appMode = payload.app.mode;
  }

  if (payload.app?.release) {
    entry.appRelease = payload.app.release;
  }

  return entry;
};
