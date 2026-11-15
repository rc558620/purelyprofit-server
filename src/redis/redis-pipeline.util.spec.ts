import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  compileSimpleRedisGlob,
  isSimpleRedisGlob,
  pipelineUnlinkByPatterns,
} from './redis-pipeline.util';

describe('Redis 多模式合并删除', () => {
  describe('glob 编译', () => {
    it('仅含 * 的模式识别为简单模式，复杂通配符需分流给 Redis 服务端', () => {
      expect(isSimpleRedisGlob('club:menu:store:1:v:*')).toBe(true);
      expect(isSimpleRedisGlob('club:menu:store:?:v:*')).toBe(false);
      expect(isSimpleRedisGlob('club:menu:store:[12]:v:*')).toBe(false);
      expect(isSimpleRedisGlob('club:menu:store:\\1:v:*')).toBe(false);
    });

    it('* 匹配任意后缀，其余部分按字面量匹配', () => {
      const matcher = compileSimpleRedisGlob('profit:members:list:store:18:*');

      expect(matcher.test('profit:members:list:store:18:page:1')).toBe(true);
      expect(matcher.test('profit:members:list:store:18:')).toBe(true);
      // 不能误伤相邻门店或别的缓存域
      expect(matcher.test('profit:members:list:store:180:page:1')).toBe(false);
      expect(matcher.test('profit:members:meta:store:18:page:1')).toBe(false);
    });

    it('正则元字符被转义，不会变成通配', () => {
      const matcher = compileSimpleRedisGlob('a.b+c:*');

      expect(matcher.test('a.b+c:x')).toBe(true);
      expect(matcher.test('axb+c:x')).toBe(false);
      expect(matcher.test('abbbbc:x')).toBe(false);
    });
  });

  describe('pipelineUnlinkByPatterns', () => {
    const logger = new Logger('RedisPipelineUtilTest');

    const buildClient = (keys: string[]) => {
      const pipeline = {
        unlink: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const scan = jest.fn().mockResolvedValue(['0', keys]);
      const client = {
        scan,
        pipeline: jest.fn(() => pipeline),
      } as unknown as Redis;
      return { client, scan, pipeline };
    };

    it('一次 SCAN 遍历删除多个模式命中的 key，未命中的不删', async () => {
      const { client, scan, pipeline } = buildClient([
        'profit:marketing:customers:list:store:11:page:1',
        'profit:marketing:customer:detail:store:11:7',
        'club:member-snapshot:store:11:user:9',
        'profit:marketing:customers:list:store:12:page:1',
        'unrelated:key',
      ]);

      await pipelineUnlinkByPatterns(
        client,
        [
          'profit:marketing:customers:list:store:11:*',
          'profit:marketing:customer:detail:store:11:*',
          'club:member-snapshot:store:11:user:*',
        ],
        logger,
        false,
        20,
      );

      // 无论有多少模式，只遍历一次 keyspace
      expect(scan).toHaveBeenCalledTimes(1);
      expect(pipeline.unlink.mock.calls.map(([key]) => key)).toEqual([
        'profit:marketing:customers:list:store:11:page:1',
        'profit:marketing:customer:detail:store:11:7',
        'club:member-snapshot:store:11:user:9',
      ]);
    });

    it('多轮 SCAN 直到 cursor 归零', async () => {
      const pipeline = {
        unlink: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const scan = jest
        .fn()
        .mockResolvedValueOnce(['17', ['club:menu:store:1:v:a']])
        .mockResolvedValueOnce(['0', ['club:menu:store:1:v:b']]);
      const client = {
        scan,
        pipeline: jest.fn(() => pipeline),
      } as unknown as Redis;

      await pipelineUnlinkByPatterns(
        client,
        ['club:menu:store:1:v:*'],
        logger,
        false,
        20,
      );

      expect(scan).toHaveBeenCalledTimes(2);
      expect(pipeline.unlink.mock.calls.map(([key]) => key)).toEqual([
        'club:menu:store:1:v:a',
        'club:menu:store:1:v:b',
      ]);
    });
  });
});
