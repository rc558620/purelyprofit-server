import {
  buildFinanceReportAllPattern,
  buildFinanceReportCacheKey,
  buildFinanceReportPattern,
  parseFinanceReportCacheKey,
} from './finance.cache-keys';

describe('财务报表缓存 key（summary / rows 拆分）', () => {
  const query = {
    period: 'custom_range',
    year: 2026,
    customDate: null,
    rangeStartDate: 20260101,
    rangeEndDate: 20260131,
    scope: 'owner' as const,
  };

  it('两个 part 只有最后一段不同，其余逐字一致', () => {
    const summaryKey = buildFinanceReportCacheKey(18, query, 'summary');
    const rowsKey = buildFinanceReportCacheKey(18, query, 'rows');

    expect(summaryKey).toBe(
      'profit:finance:report:store:18:scope:owner:period:custom_range:year:2026:customDate:na:rangeStart:20260101:rangeEnd:20260131:part:summary',
    );
    expect(rowsKey.endsWith(':part:rows')).toBe(true);
    expect(summaryKey.slice(0, summaryKey.lastIndexOf(':'))).toBe(
      rowsKey.slice(0, rowsKey.lastIndexOf(':')),
    );
  });

  it('两个 part 都落在同一个失效前缀下，写操作不会漏清一半', () => {
    const storePrefix = 'profit:finance:report:store:18:';

    for (const part of ['summary', 'rows'] as const) {
      const key = buildFinanceReportCacheKey(18, query, part);
      expect(key.startsWith(storePrefix)).toBe(true);
      expect(buildFinanceReportPattern(18)).toBe(`${storePrefix}*`);
      expect(key.startsWith('profit:finance:report:store:')).toBe(true);
      expect(buildFinanceReportAllPattern()).toBe(
        'profit:finance:report:store:*',
      );
    }
  });

  it('parse 能还原门店、scope、part 与区间参数', () => {
    const parsed = parseFinanceReportCacheKey(
      buildFinanceReportCacheKey(18, query, 'rows'),
    );

    expect(parsed).toEqual({
      storeId: 18,
      scope: 'owner',
      part: 'rows',
      period: 'custom_range',
      year: 2026,
      customDate: undefined,
      rangeStartDate: 20260101,
      rangeEndDate: 20260131,
    });
  });

  it('na 段解析为 undefined，避免把字符串 "na" 当成参数传给查询', () => {
    const parsed = parseFinanceReportCacheKey(
      buildFinanceReportCacheKey(
        7,
        { period: 'month', year: null, customDate: null, rangeStartDate: null },
        'summary',
      ),
    );

    expect(parsed).toMatchObject({
      storeId: 7,
      period: 'month',
      year: undefined,
      customDate: undefined,
      rangeStartDate: undefined,
      rangeEndDate: undefined,
    });
  });

  it('缺少 part 段或 part 非法时解析为 null（不会被当成可预热 key）', () => {
    // 拆分前的旧 key 形态：没有 part 段
    expect(
      parseFinanceReportCacheKey(
        'profit:finance:report:store:18:scope:owner:period:month:year:na:customDate:na:rangeStart:na:rangeEnd:na',
      ),
    ).toBeNull();
    expect(
      parseFinanceReportCacheKey(
        'profit:finance:report:store:18:scope:owner:period:month:year:na:customDate:na:rangeStart:na:rangeEnd:na:part:other',
      ),
    ).toBeNull();
    expect(
      parseFinanceReportCacheKey('profit:finance:overview:store:1'),
    ).toBeNull();
  });
});
