import {
  buildPulseSelectedStoreKey,
  mapPulseStoreSummary,
} from './pulse-store-context.utils';
import type { PulseStoreRow } from './pulse-store-context.types';

describe('pulse-store-context.utils', () => {
  it('buildPulseSelectedStoreKey 会按用户 id 组装 Redis key', () => {
    expect(buildPulseSelectedStoreKey(101)).toBe('pulse:selected-store:101');
  });

  it('mapPulseStoreSummary 优先使用 owner.realName 作为 ownerName', () => {
    const store: PulseStoreRow = {
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      owner: {
        name: '张老板',
        realName: '张三',
      },
    };

    expect(mapPulseStoreSummary(store)).toEqual({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: '0755-12345678',
      ownerId: 301,
      ownerName: '张三',
    });
  });

  it('mapPulseStoreSummary 在缺少 realName 时回退到 owner.name', () => {
    const store: PulseStoreRow = {
      id: 19,
      name: '纯利宝福田店',
      address: null,
      contactPhone: null,
      ownerId: 302,
      owner: {
        name: '李老板',
        realName: null,
      },
    };

    expect(mapPulseStoreSummary(store)).toEqual({
      id: 19,
      name: '纯利宝福田店',
      address: null,
      contactPhone: null,
      ownerId: 302,
      ownerName: '李老板',
    });
  });
});
