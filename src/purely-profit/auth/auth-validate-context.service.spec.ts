import { UnauthorizedException } from '@nestjs/common';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthRefreshTokenService } from './auth-refresh-token.service';
import { AuthSessionService } from './auth-session.service';
import { AuthUserCacheService } from './auth-user-cache.service';
import { AuthValidateContextService } from './auth-validate-context.service';
import { AUTH_SESSION_SET_KEY_PREFIX } from './auth.constants';
import {
  buildTokenVersionKey,
  buildUserCacheKey,
  buildUserRelatedStoreIdsCacheKey,
  buildPulseAdminMemberBanReasonKey,
} from './auth.utils';
import type { JwtPayload } from './strategies/jwt.strategy';
import type {
  ReadPipelineResult,
  RedisReadReply,
} from '../../redis/redis-pipeline.util';
import type { ChainableCommander } from 'ioredis';

const USER_ID = 201;
const STORE_ID = 11;

/**
 * 鉴权链路 Redis 替身：记录每条命令、支持失败注入，
 * 并把 pipeline 视作「一次往返内执行多条命令」。
 */
class FakeAuthRedis {
  readonly commands: string[] = [];
  failPipeline = false;
  failMget = false;

  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Set<string>>();

  seedString(key: string, raw: string): void {
    this.strings.set(key, raw);
  }

  seedJson(key: string, value: unknown): void {
    this.strings.set(key, JSON.stringify(value));
  }

  seedSession(key: string, sid: string): void {
    const members = this.zsets.get(key) ?? new Set<string>();
    members.add(sid);
    this.zsets.set(key, members);
  }

  get(key: string): Promise<string | null> {
    this.commands.push(`GET ${key}`);
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  getJson<T>(key: string): Promise<T | null> {
    this.commands.push(`GETJSON ${key}`);
    return Promise.resolve(this.parse<T>(key));
  }

  set(key: string, value: string): Promise<void> {
    this.commands.push(`SET ${key}`);
    this.strings.set(key, value);
    return Promise.resolve();
  }

  setJson(key: string, value: unknown): Promise<void> {
    this.commands.push(`SETJSON ${key}`);
    this.strings.set(key, JSON.stringify(value));
    return Promise.resolve();
  }

  mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    this.commands.push(`MGETJSON ${keys.length}`);
    if (this.failMget) {
      return Promise.reject(new Error('redis mget failed'));
    }
    return Promise.resolve(keys.map((key) => this.parse<T>(key)));
  }

  zscore(key: string, member: string): Promise<string | null> {
    this.commands.push(`ZSCORE ${key} ${member}`);
    return Promise.resolve(this.readZScore(key, member));
  }

  executeReadPipeline(
    build: (pipeline: ChainableCommander) => void,
  ): Promise<ReadPipelineResult> {
    this.commands.push('PIPELINE');
    if (this.failPipeline) {
      return Promise.resolve({ ok: false, replies: [] });
    }

    const ops: (() => RedisReadReply)[] = [];
    const pipeline = {
      get: (key: string): unknown => {
        ops.push(() => this.strings.get(key) ?? null);
        return pipeline;
      },
      mget: (...keys: string[]): unknown => {
        ops.push(() => keys.map((key) => this.strings.get(key) ?? null));
        return pipeline;
      },
      zscore: (key: string, member: string): unknown => {
        ops.push(() => this.readZScore(key, member));
        return pipeline;
      },
    };

    build(pipeline as never);
    return Promise.resolve({ ok: true, replies: ops.map((op) => op()) });
  }

  private readZScore(key: string, member: string): string | null {
    return this.zsets.get(key)?.has(member) === true ? '1750000000000' : null;
  }

  private parse<T>(key: string): T | null {
    const raw = this.strings.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  resetCommands(): void {
    this.commands.length = 0;
  }
}

const flushAsync = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('AuthValidateContextService', () => {
  let redis: FakeAuthRedis;
  let prisma: {
    user: { findUnique: jest.Mock };
    store: { findMany: jest.Mock };
  };
  let service: AuthValidateContextService;

  const userRecord = {
    id: USER_ID,
    email: 'club_phone_13800138000@purelyprofit.local',
    name: '会员',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
  };

  const payload: JwtPayload = {
    sub: USER_ID,
    phone: '13800138000',
    sessionVersion: 0,
    sid: 'sid-1',
    accountScope: 'purely_club',
  };

  const userCacheKey = buildUserCacheKey(USER_ID);
  const tokenVersionKey = buildTokenVersionKey(USER_ID);
  const sessionSetKey = `${AUTH_SESSION_SET_KEY_PREFIX}${USER_ID}`;
  const relatedStoreIdsKey = buildUserRelatedStoreIdsCacheKey(USER_ID);

  beforeEach(() => {
    redis = new FakeAuthRedis();
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(userRecord) },
      store: { findMany: jest.fn().mockResolvedValue([{ id: STORE_ID }]) },
    };

    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const sessionService = new AuthSessionService(
      redis as never,
      {} as never,
      new AuthRefreshTokenService(redis as never, configService as never),
      configService as never,
    );
    const userCacheService = new AuthUserCacheService(
      prisma as never,
      redis as never,
    );
    const banGuardService = new AuthBanGuardService(
      prisma as never,
      redis as never,
    );

    service = new AuthValidateContextService(
      redis as never,
      userCacheService,
      sessionService,
      banGuardService,
    );
  });

  /** 全部缓存命中的热路径：user / token 版本 / 活跃会话 / 关联门店 都在 Redis 里 */
  const seedWarmCache = (): void => {
    redis.seedJson(userCacheKey, userRecord);
    redis.seedString(tokenVersionKey, '0');
    redis.seedSession(sessionSetKey, 'sid-1');
    redis.seedJson(relatedStoreIdsKey, [STORE_ID]);
  };

  it('热缓存命中只需 2 次往返：1 次 pipeline + 1 次封禁 MGET', async () => {
    seedWarmCache();
    redis.resetCommands();

    const context = await service.load(payload);

    expect(context.user?.id).toBe(USER_ID);
    expect(context.currentTokenVersion).toBe(0);
    expect(context.sessionActive).toBe(true);
    expect(redis.commands).toEqual([`PIPELINE`, `MGETJSON 1`]);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.store.findMany).not.toHaveBeenCalled();
  });

  it('无 sid 的旧 token 不再发 ZSCORE，也不判会话', async () => {
    seedWarmCache();
    redis.resetCommands();

    const context = await service.load({
      sub: USER_ID,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(context.sessionActive).toBe(true);
    expect(redis.commands).toEqual([`PIPELINE`, `MGETJSON 1`]);
  });

  it('user 缓存未命中时回源数据库并回填缓存', async () => {
    seedWarmCache();
    redis.seedString(userCacheKey, 'null');

    const context = await service.load(payload);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
    expect(context.user?.email).toBe(
      'club_phone_13800138000@purelyprofit.local',
    );
    await flushAsync();
    expect(redis.commands).toContain(`SETJSON ${userCacheKey}`);
  });

  it('token 版本更高时返回当前版本供上层拒绝旧 token', async () => {
    seedWarmCache();
    redis.seedString(tokenVersionKey, '2');

    const context = await service.load(payload);

    expect(context.currentTokenVersion).toBe(2);
  });

  it('会话已从 sorted set 淘汰时 sessionActive 为 false', async () => {
    seedWarmCache();
    redis.seedSession(sessionSetKey, 'sid-1');

    const context = await service.load({ ...payload, sid: 'sid-evicted' });

    expect(context.sessionActive).toBe(false);
  });

  it('关联门店缓存未命中时回源数据库并回填', async () => {
    seedWarmCache();
    redis.seedString(relatedStoreIdsKey, 'null');

    const context = await service.load(payload);

    expect(prisma.store.findMany).toHaveBeenCalledTimes(1);
    expect(context.user?.id).toBe(USER_ID);
    await flushAsync();
    expect(redis.commands).toContain(`SETJSON ${relatedStoreIdsKey}`);
  });

  it('全部关联门店被封禁时抛出原封禁文案', async () => {
    seedWarmCache();
    redis.seedJson(buildPulseAdminMemberBanReasonKey(STORE_ID), '违规经营');

    await expect(service.load(payload)).rejects.toThrow('账号已被封禁');
  });

  it('仅部分门店被封禁时放行', async () => {
    seedWarmCache();
    redis.seedJson(relatedStoreIdsKey, [STORE_ID, 12]);
    redis.seedJson(buildPulseAdminMemberBanReasonKey(STORE_ID), '违规经营');

    const context = await service.load(payload);

    expect(context.user?.id).toBe(USER_ID);
  });

  it('封禁错误优先于「用户不存在」：与合并前 Promise.all 的失败优先级一致', async () => {
    seedWarmCache();
    redis.seedString(userCacheKey, 'null');
    prisma.user.findUnique.mockResolvedValue(null);
    redis.seedJson(buildPulseAdminMemberBanReasonKey(STORE_ID), '违规经营');

    await expect(service.load(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.load(payload)).rejects.toThrow('账号已被封禁');
  });

  it('pipeline 失败时降级为逐条读取，结果与热缓存一致', async () => {
    seedWarmCache();
    redis.failPipeline = true;
    redis.resetCommands();

    const context = await service.load(payload);

    expect(context.user?.id).toBe(USER_ID);
    expect(context.currentTokenVersion).toBe(0);
    expect(context.sessionActive).toBe(true);
    expect(redis.commands).toEqual([
      'PIPELINE',
      `GET ${userCacheKey}`,
      `GET ${tokenVersionKey}`,
      `ZSCORE ${sessionSetKey} sid-1`,
      `GETJSON ${relatedStoreIdsKey}`,
      'MGETJSON 1',
    ]);
  });

  it('pipeline 失败后封禁判定照旧生效，不放行', async () => {
    seedWarmCache();
    redis.failPipeline = true;
    redis.seedJson(buildPulseAdminMemberBanReasonKey(STORE_ID), '违规经营');

    await expect(service.load(payload)).rejects.toThrow('账号已被封禁');
  });

  it('封禁 MGET 失败时降级为逐条读取，判定条件不变', async () => {
    seedWarmCache();
    redis.failMget = true;
    redis.seedJson(buildPulseAdminMemberBanReasonKey(STORE_ID), '违规经营');

    await expect(service.load(payload)).rejects.toThrow('账号已被封禁');
    expect(redis.commands).toContain(
      `GETJSON ${buildPulseAdminMemberBanReasonKey(STORE_ID)}`,
    );
  });

  it('批量读取与降级读取对「未封禁」的结论一致', async () => {
    seedWarmCache();

    const batched = await service.load(payload);

    redis.failPipeline = true;
    const degraded = await service.load(payload);

    expect(degraded.user?.id).toBe(batched.user?.id);
    expect(degraded.currentTokenVersion).toBe(batched.currentTokenVersion);
    expect(degraded.sessionActive).toBe(batched.sessionActive);
  });
});
