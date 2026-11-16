import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AUTH_USER_CACHE_TTL_SECONDS } from './auth.constants';
import { buildUserCacheKey } from './auth.utils';

/**
 * 鉴权链路缓存的 user 最小字段集。
 * Date 字段在 Redis JSON 中为 ISO 字符串，反序列化时需转回 Date。
 */
interface CachedUserRecord {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastActiveAt: Date | string | null;
}

/** resolveUser 返回的标准化 user 记录，Date 字段已从 Redis 反序列化回 Date 类型。 */
export interface ResolvedAuthUserRecord {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
}

/**
 * 鉴权用户快照缓存：HTTP（JwtStrategy）与 WebSocket（实时网关）共用同一份缓存。
 *
 * 单独成 Service 的原因：WS 建连原本各自直查 `users` 表，拿不到 HTTP 侧已有的
 * 5 分钟缓存。弱网重连风暴下每个 socket 都会打一次 DB，且随后还要叠加完整的
 * membership 解析。把 key 构造、TTL 与 Date 复原收敛到一处，两条链路才不会
 * 各自演化出不同口径（例如一边缓存 5 分钟、另一边直查）。
 */
@Injectable()
export class AuthUserCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 从 Redis 缓存或数据库解析 user 基础信息。
   *
   * 缓存 TTL 与 lastActiveAt 节流窗口对齐（5 分钟），用户资料变更时由
   * AuthProfileService / 员工档案写入链路主动失效。
   * 缓存仅包含鉴权所需的最小字段集，不包含密码、头像等敏感或非必要字段。
   */
  async resolveUser(userId: number): Promise<ResolvedAuthUserRecord | null> {
    const cacheKey = buildUserCacheKey(userId);
    const cached = await this.redisService.getJson<CachedUserRecord>(cacheKey);

    if (cached) {
      return {
        ...cached,
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
        lastActiveAt: cached.lastActiveAt
          ? new Date(cached.lastActiveAt)
          : null,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        lastActiveAt: true,
      },
    });

    if (!user) {
      return null;
    }

    // 非关键路径：fire-and-forget 回填缓存，不阻塞鉴权流程
    void this.backfillUserCache(cacheKey, user);

    return user;
  }

  /**
   * fire-and-forget 回填用户缓存，失败时静默忽略。
   * 由 resolveUser 通过 void 调用，不阻塞鉴权主流程。
   */
  private async backfillUserCache(
    cacheKey: string,
    user: ResolvedAuthUserRecord,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        user,
        AUTH_USER_CACHE_TTL_SECONDS,
      );
    } catch {
      // 缓存写入失败不影响鉴权
    }
  }
}
