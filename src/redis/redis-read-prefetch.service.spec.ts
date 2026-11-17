import { Logger } from '@nestjs/common';
import { RedisReadPrefetchService } from './redis-read-prefetch.service';
import type { RedisService } from './redis.service';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('RedisReadPrefetchService · 请求级 Redis 只读预取容器', () => {
  let redis: { mget: jest.Mock };
  let service: RedisReadPrefetchService;

  const buildRedis = (
    impl: (keys: string[]) => Promise<(string | null)[]>,
  ): { mget: jest.Mock } => ({
    mget: jest.fn(impl),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis = buildRedis((keys) =>
      Promise.resolve(keys.map((key) => JSON.stringify({ from: key }))),
    );
    service = new RedisReadPrefetchService(redis as unknown as RedisService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('预取命中', () => {
    it('一次 MGET 取回全部 key，后续多次读取不再产生往返', async () => {
      const result = await service.run(async () => {
        service.start(['a', 'b']);
        const first = await service.peekJson<{ from: string }>('a');
        const second = await service.peekJson<{ from: string }>('a');
        const third = await service.peekJson<{ from: string }>('b');
        return { first, second, third };
      });

      expect(result.first).toEqual({ from: 'a' });
      expect(result.second).toEqual({ from: 'a' });
      expect(result.third).toEqual({ from: 'b' });
      // 3 次读取共用 1 次 MGET：容器是请求级加速层，不逐 key 回源
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(['a', 'b']);
    });

    it('重复 start 只发起一次 MGET，且自动去重 key', async () => {
      await service.run(async () => {
        service.start(['a', 'a', 'b']);
        service.start(['c']);
        await service.peekJson('a');
      });

      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  describe('预取 miss 回退', () => {
    it('已预取且 key 不存在时返回 null（等价于 GET 未命中）', async () => {
      redis = buildRedis((keys) => Promise.resolve(keys.map(() => null)));
      service = new RedisReadPrefetchService(redis as unknown as RedisService);

      const value = await service.run(async () => {
        service.start(['missing']);
        return service.peekJson('missing');
      });

      expect(value).toBeNull();
    });

    it('未预取的 key 返回 undefined，调用方据此回退原有读取', async () => {
      const value = await service.run(async () => {
        service.start(['a']);
        return service.peekJson('never-prefetched');
      });

      expect(value).toBeUndefined();
    });

    it('未处于 run 作用域时 start / peekJson 均为安全 no-op', async () => {
      service.start(['a']);
      await expect(service.peekJson('a')).resolves.toBeUndefined();
      expect(redis.mget).not.toHaveBeenCalled();
    });

    it('空 key 列表不发起 MGET', async () => {
      await service.run(async () => {
        service.start([]);
        await expect(service.peekJson('a')).resolves.toBeUndefined();
      });

      expect(redis.mget).not.toHaveBeenCalled();
    });

    it('单个值 JSON 解析失败只影响该 key，整体不抛错', async () => {
      redis = buildRedis((keys) =>
        Promise.resolve(
          keys.map((key) =>
            key === 'broken' ? '{not-json' : JSON.stringify(key),
          ),
        ),
      );
      service = new RedisReadPrefetchService(redis as unknown as RedisService);

      const result = await service.run(async () => {
        service.start(['broken', 'ok']);
        return {
          broken: await service.peekJson('broken'),
          ok: await service.peekJson('ok'),
        };
      });

      expect(result.broken).toBeUndefined();
      expect(result.ok).toBe('ok');
    });
  });

  describe('Redis 异常降级', () => {
    it('MGET 失败时全部返回 undefined 且不向上抛错', async () => {
      redis = buildRedis(() => Promise.reject(new Error('redis down')));
      service = new RedisReadPrefetchService(redis as unknown as RedisService);

      const result = await service.run(async () => {
        service.start(['a']);
        return {
          a: await service.peekJson('a'),
          b: await service.peekJson('b'),
        };
      });

      expect(result.a).toBeUndefined();
      expect(result.b).toBeUndefined();
      expect(redis.mget).toHaveBeenCalledTimes(1);
    });
  });

  describe('并发请求隔离', () => {
    it('两个并发请求各自持有独立容器，互不可见', async () => {
      redis = buildRedis(async (keys) => {
        // 让两个请求的预取真正重叠，暴露可能的跨请求共享
        await sleep(5);
        return keys.map((key) => JSON.stringify(`value-of-${key}`));
      });
      service = new RedisReadPrefetchService(redis as unknown as RedisService);

      const runInOwnScope = (
        ownKey: string,
        otherKey: string,
      ): Promise<{
        own: string | null | undefined;
        other: string | null | undefined;
      }> =>
        service.run(async () => {
          service.start([ownKey]);
          const own = await service.peekJson<string>(ownKey);
          await sleep(10);
          // 另一个请求已预取该 key，但本请求的容器里没有 → 必须回退
          const other = await service.peekJson<string>(otherKey);
          return { own, other };
        });

      const [first, second] = await Promise.all([
        runInOwnScope('k:a', 'k:b'),
        runInOwnScope('k:b', 'k:a'),
      ]);

      expect(first).toEqual({ own: 'value-of-k:a', other: undefined });
      expect(second).toEqual({ own: 'value-of-k:b', other: undefined });
      expect(redis.mget).toHaveBeenCalledTimes(2);
      expect(redis.mget).toHaveBeenNthCalledWith(1, ['k:a']);
      expect(redis.mget).toHaveBeenNthCalledWith(2, ['k:b']);
    });

    it('前一个作用域的预取结果不会泄漏到之后新建的作用域', async () => {
      const firstValue = await service.run(async () => {
        service.start(['a']);
        return service.peekJson('a');
      });
      const secondValue = await service.run(async () => service.peekJson('a'));

      expect(firstValue).toEqual({ from: 'a' });
      expect(secondValue).toBeUndefined();
    });
  });
});
