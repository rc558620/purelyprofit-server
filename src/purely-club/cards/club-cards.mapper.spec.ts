// C 端持卡视图映射：状态按有效期 / 剩余次数派生，到期时间如实返回 null
import type { ClubMemberCardSnapshot } from './club-cards.types';
import { toCardView, toUsageTypeValue } from './club-cards.mapper';

const NOW = new Date('2026-11-02T12:00:00.000Z');

const buildSnapshot = (
  overrides: Partial<ClubMemberCardSnapshot>,
): ClubMemberCardSnapshot => ({
  id: 1,
  storeId: 2,
  planId: 3,
  cardNo: 'K202611020001',
  kind: 'times',
  nameSnapshot: '10 次畅打卡',
  status: 'active',
  startsAt: new Date('2026-10-01T00:00:00.000Z'),
  expiresAt: new Date('2027-04-01T00:00:00.000Z'),
  totalTimes: 10,
  remainTimes: 10,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

describe('toCardView 状态派生', () => {
  const base = { storeName: '望京店', now: NOW };

  it('次数卡剩余 0 次时派生为 usedUp，不依赖数据库翻转', () => {
    const view = toCardView({
      ...base,
      card: buildSnapshot({ remainTimes: 0 }),
    });

    expect(view.status).toBe('usedUp');
    expect(view.statusText).toBe('次数用尽');
  });

  it('时长卡已过到期时间时派生为 expired', () => {
    const view = toCardView({
      ...base,
      card: buildSnapshot({
        kind: 'yearly',
        totalTimes: null,
        remainTimes: null,
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    });

    expect(view.status).toBe('expired');
    expect(view.remainDays).toBe(0);
  });

  it('次数用尽优先于过期：同时命中时给出 usedUp', () => {
    const view = toCardView({
      ...base,
      card: buildSnapshot({
        remainTimes: 0,
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    });

    expect(view.status).toBe('usedUp');
  });

  it('数据库已置非 active 的状态不被派生覆盖', () => {
    const view = toCardView({
      ...base,
      card: buildSnapshot({ status: 'frozen' }),
    });

    expect(view.status).toBe('frozen');
  });

  it('不设到期的卡：expireAt 返回 null，剩余天数返回 null（不是 0）', () => {
    const view = toCardView({
      ...base,
      card: buildSnapshot({
        kind: 'yearly',
        totalTimes: null,
        remainTimes: null,
        expiresAt: null,
      }),
    });

    expect(view.expireAt).toBeNull();
    expect(view.remainDays).toBeNull();
    expect(view.status).toBe('active');
  });
});

describe('toUsageTypeValue', () => {
  it('手动调次与到期失效必须与办卡区分', () => {
    expect(toUsageTypeValue('adjust')).toBe('adjust');
    expect(toUsageTypeValue('expire')).toBe('expire');
    expect(toUsageTypeValue('purchase')).toBe('issue');
    expect(toUsageTypeValue('reserve')).toBe('consume');
    expect(toUsageTypeValue('release')).toBe('release');
  });
});
