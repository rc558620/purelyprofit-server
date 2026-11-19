import {
  buildProfitDetailCacheKey,
  buildProfitReportCacheKey,
  normalizeProfitCacheQuery,
} from './profit-detail.cache-keys';

/**
 * 缓存键必须只由「真正影响区间计算的字段」决定。
 *
 * 否则等价请求（如 year 周期多带了不参与计算的 startTime/endTime）会生成
 * 两个 key，首页预热写进去的缓存永远命中不了详情页的真实请求。
 */
describe('profit 缓存键归一化', () => {
  it('year 周期忽略不参与计算的 startTime/endTime', () => {
    const withoutExtra = buildProfitDetailCacheKey(18, { period: 'year' });
    const withExtra = buildProfitDetailCacheKey(18, {
      period: 'year',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_100_000,
    });

    expect(withExtra).toBe(withoutExtra);
    expect(withoutExtra).toContain('period:year');
    expect(withoutExtra).toContain('startTime:na');
  });

  it('year 周期保留显式年份，避免跨年复用错年份缓存', () => {
    const currentYear = buildProfitDetailCacheKey(18, { period: 'year' });
    const explicitYear = buildProfitDetailCacheKey(18, {
      period: 'year',
      year: 2025,
    });

    expect(explicitYear).not.toBe(currentYear);
    expect(explicitYear).toContain('year:2025');
  });

  it('custom_range 的 rangeStart/rangeEnd 与 startTime/endTime 收敛为同一个 key', () => {
    const byRange = buildProfitDetailCacheKey(18, {
      period: 'custom_range',
      rangeStartDate: 1_700_000_000_000,
      rangeEndDate: 1_700_100_000_000,
    });
    const byTime = buildProfitDetailCacheKey(18, {
      period: 'custom_range',
      startTime: 1_700_000_000_000,
      endTime: 1_700_100_000_000,
    });

    expect(byTime).toBe(byRange);
  });

  it('custom_month 的 customDate 与 startTime 收敛为同一个 key', () => {
    const byCustomDate = buildProfitDetailCacheKey(18, {
      period: 'custom_month',
      customDate: 1_700_000_000_000,
    });
    const byStartTime = buildProfitDetailCacheKey(18, {
      period: 'custom_month',
      startTime: 1_700_000_000_000,
    });

    expect(byStartTime).toBe(byCustomDate);
  });

  it('report 与 detail 使用同一归一化规则，仅前缀不同', () => {
    const detailKey = buildProfitDetailCacheKey(18, {
      period: 'year',
      startTime: 1,
      endTime: 2,
    });
    const reportKey = buildProfitReportCacheKey(18, {
      period: 'year',
      startTime: 1,
      endTime: 2,
    });

    expect(reportKey).toBe(
      detailKey.replace('profit:profit-detail', 'profit:profit-report'),
    );
  });

  it('normalizeProfitCacheQuery 默认周期按 month 处理', () => {
    expect(normalizeProfitCacheQuery({})).toEqual({ period: 'month' });
  });
});
