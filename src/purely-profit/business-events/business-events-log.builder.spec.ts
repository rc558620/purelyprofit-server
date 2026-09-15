import {
  BUSINESS_EVENT_MAX_PROPERTIES,
  BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH,
  buildBusinessEventLog,
  normalizeBusinessEventProperties,
} from './business-events-log.builder';
import type { BusinessEventReportDto } from './dto/business-event-report.dto';

const createPayload = (
  overrides: Partial<BusinessEventReportDto> = {},
): BusinessEventReportDto => ({
  eventId: 'evt_1719500000000_ab12cd',
  name: 'membership_quota_blocked',
  occurredAt: '2026-09-14T09:30:00.000Z',
  pathname: '/product-list',
  planTier: 'free',
  properties: {
    resource: 'product',
    limit: 3,
    currentCount: 50,
    isOverQuota: true,
  },
  app: {
    mode: 'production',
    release: '1.0.0',
    userAgent: 'Mozilla/5.0',
  },
  store: {
    id: 18,
  },
  ...overrides,
});

describe('normalizeBusinessEventProperties', () => {
  it('只保留可聚合的原始类型，丢弃 null、undefined、嵌套对象与数组', () => {
    const result = normalizeBusinessEventProperties({
      resource: 'product',
      limit: 3,
      isOverQuota: true,
      droppedNull: null,
      droppedUndefined: undefined,
      droppedObject: { nested: 1 },
      droppedArray: [1, 2, 3],
    });

    expect(result).toEqual({
      resource: 'product',
      limit: 3,
      isOverQuota: true,
    });
  });

  it('超长字符串按上限截断，避免单条日志被撑爆', () => {
    const longValue = 'x'.repeat(BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH + 50);

    const result = normalizeBusinessEventProperties({ reason: longValue });

    expect(result.reason).toHaveLength(BUSINESS_EVENT_PROPERTY_VALUE_MAX_LENGTH);
  });

  it('属性个数超过上限时只保留前 N 个', () => {
    const oversized: Record<string, number> = {};
    for (let index = 0; index < BUSINESS_EVENT_MAX_PROPERTIES + 10; index += 1) {
      oversized[`key${index}`] = index;
    }

    const result = normalizeBusinessEventProperties(oversized);

    expect(Object.keys(result)).toHaveLength(BUSINESS_EVENT_MAX_PROPERTIES);
  });

  it('非有限数值（NaN / Infinity）被丢弃', () => {
    const result = normalizeBusinessEventProperties({
      notANumber: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      validNumber: 12,
    });

    expect(result).toEqual({ validNumber: 12 });
  });

  it('属性缺失或非对象时返回空对象', () => {
    expect(normalizeBusinessEventProperties(undefined)).toEqual({});
    expect(normalizeBusinessEventProperties({})).toEqual({});
  });
});

describe('buildBusinessEventLog', () => {
  it('组装事件核心字段并带上档位、门店与应用版本', () => {
    const entry = buildBusinessEventLog(createPayload());

    expect(entry).toEqual({
      kind: 'business-event',
      eventId: 'evt_1719500000000_ab12cd',
      name: 'membership_quota_blocked',
      occurredAt: '2026-09-14T09:30:00.000Z',
      pathname: '/product-list',
      planTier: 'free',
      storeId: 18,
      appMode: 'production',
      appRelease: '1.0.0',
      properties: {
        resource: 'product',
        limit: 3,
        currentCount: 50,
        isOverQuota: true,
      },
    });
  });

  it('可选上下文缺失时不写入对应字段，避免日志里出现一堆 undefined', () => {
    const entry = buildBusinessEventLog(
      createPayload({ planTier: undefined, app: undefined, store: undefined }),
    );

    expect(entry).not.toHaveProperty('planTier');
    expect(entry).not.toHaveProperty('storeId');
    expect(entry).not.toHaveProperty('appMode');
    expect(entry).not.toHaveProperty('appRelease');
  });
});
