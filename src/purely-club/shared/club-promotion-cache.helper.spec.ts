import {
  CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS,
  resolveClubPromotionCacheTtlSeconds,
  runClubPromotionSingleflight,
} from './club-promotion-cache.helper';

const NOW = new Date('2026-06-12T12:00:00.000Z').getTime();

const timeWindow = (
  startAtIso: string,
  endAtIso: string,
): {
  startAt: Date;
  endAt: Date;
} => ({ startAt: new Date(startAtIso), endAt: new Date(endAtIso) });

describe('resolveClubPromotionCacheTtlSeconds', () => {
  it('无活动时不截断，取兜底上限', () => {
    expect(resolveClubPromotionCacheTtlSeconds([], NOW)).toBe(
      CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS,
    );
  });

  it('进行中活动的结束时间决定 TTL', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T12:00:10.000Z')],
      NOW,
    );

    expect(ttl).toBe(10);
  });

  it('未开始活动用「开始」时间决定 TTL（到点即生效）', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [timeWindow('2026-06-12T12:00:05.000Z', '2026-06-12T18:00:00.000Z')],
      NOW,
    );

    expect(ttl).toBe(5);
  });

  it('多个边界取最近的一个', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [
        timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T12:00:30.000Z'),
        timeWindow('2026-06-12T12:00:07.000Z', '2026-06-12T13:00:00.000Z'),
        timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T12:15:00.000Z'),
      ],
      NOW,
    );

    expect(ttl).toBe(7);
  });

  it('边界不足 1s 时夹到 1s：RedisService 会把 0 当成「不设 TTL」', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T12:00:00.200Z')],
      NOW,
    );

    expect(ttl).toBe(1);
  });

  it('边界超过上限时夹到上限', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T20:00:00.000Z')],
      NOW,
    );

    expect(ttl).toBe(CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS);
  });

  it('已结束的活动不参与边界计算', () => {
    const ttl = resolveClubPromotionCacheTtlSeconds(
      [timeWindow('2026-06-01T00:00:00.000Z', '2026-06-12T11:00:00.000Z')],
      NOW,
    );

    expect(ttl).toBe(CLUB_PROMOTION_CACHE_MAX_TTL_SECONDS);
  });
});

describe('runClubPromotionSingleflight', () => {
  it('并发未命中只回源一次，多个调用方拿到同一结果', async () => {
    const inflight = new Map<string, Promise<number>>();
    const load = jest.fn(async () => {
      await Promise.resolve();
      return 42;
    });

    const [first, second] = await Promise.all([
      runClubPromotionSingleflight(inflight, 'k', load),
      runClubPromotionSingleflight(inflight, 'k', load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(inflight.size).toBe(0);
  });

  it('回源失败后清空在途记录，下次请求可以重试', async () => {
    const inflight = new Map<string, Promise<number>>();
    const load = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(7);

    await expect(
      runClubPromotionSingleflight(inflight, 'k', load),
    ).rejects.toThrow('db down');
    expect(inflight.size).toBe(0);

    await expect(
      runClubPromotionSingleflight(inflight, 'k', load),
    ).resolves.toBe(7);
  });

  it('不同 key 互不阻塞', async () => {
    const inflight = new Map<string, Promise<string>>();
    const loadA = jest.fn(() => Promise.resolve('a'));
    const loadB = jest.fn(() => Promise.resolve('b'));

    await Promise.all([
      runClubPromotionSingleflight(inflight, 'a', loadA),
      runClubPromotionSingleflight(inflight, 'b', loadB),
    ]);

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });
});
