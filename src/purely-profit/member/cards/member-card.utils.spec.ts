// 会员卡到期时间口径：以生效日的上海零点为基准，落在第 validDays 天的最后一毫秒
import { resolveCardExpiresAt } from './member-card.utils';

describe('resolveCardExpiresAt', () => {
  it('30 天卡到期时间为第 30 天的上海日终（23:59:59.999）', () => {
    // 2026-11-03 22:00（上海）= 2026-11-03T14:00:00.000Z
    const expiresAt = resolveCardExpiresAt(
      Date.parse('2026-11-03T14:00:00.000Z'),
      30,
    );

    // 第 1 天为生效当天 11-03，第 30 天为 12-02 日终
    expect(expiresAt.toISOString()).toBe('2026-12-02T15:59:59.999Z');
  });

  it('同一上海自然日内的不同购买时刻，到期时间完全一致', () => {
    // 00:30 与 23:30（上海）购买同档卡，不得因为购买时刻不同而差出一天
    const morning = resolveCardExpiresAt(
      Date.parse('2026-11-02T16:30:00.000Z'),
      30,
    );
    const night = resolveCardExpiresAt(
      Date.parse('2026-11-03T15:30:00.000Z'),
      30,
    );

    expect(morning.toISOString()).toBe(night.toISOString());
  });

  it('1 天卡只在购买当天有效', () => {
    const expiresAt = resolveCardExpiresAt(
      Date.parse('2026-11-03T14:00:00.000Z'),
      1,
    );

    expect(expiresAt.toISOString()).toBe('2026-11-03T15:59:59.999Z');
  });
});
