import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { AUTH_SESSION_TOKEN_HASH_KEY_PREFIX } from './auth.constants';

/**
 * Refresh token 在 Redis 中的 key 前缀
 */
const REFRESH_TOKEN_KEY_PREFIX = 'auth:refresh-token:';

/**
 * Refresh token 默认有效期（秒）：30 天
 */
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * 持久化在 Redis 中的 refresh token 载荷。
 *
 * key 为 token 的 SHA-256，Redis 内不出现明文 token。
 */
export interface RefreshTokenPayload {
  userId: number;
  phone: string;
  email: string;
  accountScope?: string;
  staffId?: number;
  sid?: string;
}

/**
 * refresh token 的签发、轮换与吊销。
 *
 * 从 `AuthSessionService` 拆出：会话活性（sorted set）与 token 轮换（GETDEL + 哈希索引）
 * 是两条独立的存储关注点，各自只依赖 `RedisService`，拆开后单文件规模与职责都收敛。
 */
@Injectable()
export class AuthRefreshTokenService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.ttlSeconds =
      configService.get<number>('auth.refreshTokenTtlSeconds') ??
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  }

  /**
   * 签发 refresh token 并落库，返回明文（仅此一次，Redis 只存哈希）。
   *
   * 同时维护 userId → tokenHash 索引与 sid → tokenHash 映射，
   * 前者服务「按用户批量失效」，后者服务「会话淘汰时精确清理」。
   */
  async issue(payload: RefreshTokenPayload): Promise<string> {
    const token = `rt_${randomBytes(32).toString('hex')}`;
    const tokenHash = this.hashToken(token);

    await this.redisService.setJson(
      this.buildTokenKey(tokenHash),
      payload,
      this.ttlSeconds,
    );
    await this.addToUserIndex(payload.userId, tokenHash);

    if (payload.sid) {
      await this.redisService.set(
        this.buildSessionMappingKey(payload.userId, payload.sid),
        tokenHash,
        this.ttlSeconds,
      );
    }

    return token;
  }

  /**
   * 原子消费 refresh token（GETDEL）。
   *
   * 一次性使用：并发刷新时只有一个调用能拿到载荷，其余返回 null。
   */
  async consume(rawToken: string): Promise<RefreshTokenPayload | null> {
    return this.redisService.getJsonAndDelete<RefreshTokenPayload>(
      this.buildTokenKey(this.hashToken(rawToken)),
    );
  }

  /**
   * 使指定用户的所有 refresh token 失效（密码变更 / 强制登出时调用）。
   *
   * 通过 userId 索引 set 批量删除，避免全量 SCAN。
   */
  async invalidateAll(userId: number): Promise<void> {
    const tokenHashes = await this.readUserIndex(userId);

    if (tokenHashes.length > 0) {
      await this.redisService.delMany(
        tokenHashes.map((hash) => this.buildTokenKey(hash)),
      );
    }

    // 清除索引
    await this.redisService.del(this.buildIndexKey(userId));
  }

  /**
   * 吊销指定会话持有的 refresh token（会话被并发上限淘汰时调用）。
   *
   * 按 sid → tokenHash 映射精确清理，避免误删同用户其它会话的 token。
   */
  async revokeSessions(userId: number, sids: string[]): Promise<void> {
    if (sids.length === 0) return;

    const mappingKeys = sids.map((sid) =>
      this.buildSessionMappingKey(userId, sid),
    );
    const tokenHashes = await this.redisService.mget(mappingKeys);
    const validHashes = tokenHashes.filter((hash): hash is string =>
      Boolean(hash),
    );

    const keysToDelete = validHashes.map((hash) => this.buildTokenKey(hash));
    keysToDelete.push(...mappingKeys);
    await this.redisService.delMany(keysToDelete);

    await this.pruneUserIndex(userId, validHashes);
  }

  // ── userId → tokenHash 索引（兼容旧格式） ─────────────────

  private buildTokenKey(tokenHash: string): string {
    return `${REFRESH_TOKEN_KEY_PREFIX}${tokenHash}`;
  }

  private buildIndexKey(userId: number): string {
    return `${REFRESH_TOKEN_KEY_PREFIX}user-index:${userId}`;
  }

  private buildSessionMappingKey(userId: number, sid: string): string {
    return `${AUTH_SESSION_TOKEN_HASH_KEY_PREFIX}${userId}:${sid}`;
  }

  /**
   * 对 refresh token 做 SHA-256 哈希，避免在 Redis 中存储明文
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * 写入 userId → tokenHash 索引。
   *
   * 索引仍是旧格式时先迁移为 SET 再写入：旧引用保留在 SET 中，避免旧 refresh token
   * 失去索引后无法被批量失效。迁移只在首次遇到旧 key 时发生，稳态无额外开销。
   */
  private async addToUserIndex(
    userId: number,
    tokenHash: string,
  ): Promise<void> {
    const indexKey = this.buildIndexKey(userId);

    try {
      await this.redisService.sadd(indexKey, tokenHash, this.ttlSeconds);
      return;
    } catch (error: unknown) {
      if (!this.isWrongTypeError(error)) throw error;
    }

    const legacyHashes = await this.readLegacyUserIndex(indexKey);
    await this.redisService.del(indexKey);
    if (legacyHashes.length > 0) {
      await this.redisService.saddMany(indexKey, legacyHashes);
    }
    await this.redisService.sadd(indexKey, tokenHash, this.ttlSeconds);
  }

  /**
   * 读取 userId → tokenHash 索引。
   *
   * 早期版本把索引存成 JSON 数组字符串，当前版本改用 Redis SET（SADD/SREM 原子操作，
   * 避免并发「读-改-写」丢引用）。存量旧数据未清理时 SMEMBERS 会抛 WRONGTYPE，
   * 这里回退解析旧格式，确保改密码/强制登出仍能批量失效旧 refresh token。
   */
  private async readUserIndex(userId: number): Promise<string[]> {
    const indexKey = this.buildIndexKey(userId);
    try {
      return await this.redisService.smembers(indexKey);
    } catch (error: unknown) {
      if (!this.isWrongTypeError(error)) throw error;
      return this.readLegacyUserIndex(indexKey);
    }
  }

  /**
   * 从 user-index set 中移除已失效的 token hash 引用，
   * 避免索引无限增长。SREM 为原子操作，并发刷新不会丢引用。
   */
  private async pruneUserIndex(
    userId: number,
    removedHashes: string[],
  ): Promise<void> {
    if (removedHashes.length === 0) return;

    try {
      await this.redisService.srem(
        this.buildIndexKey(userId),
        ...removedHashes,
      );
    } catch (error: unknown) {
      // 索引仍是旧格式（JSON 数组字符串）时 SREM 会抛 WRONGTYPE。
      // 索引只影响「按 userId 批量失效」，不能因此让会话淘汰/登录失败；
      // 旧引用会在下次写入索引时随迁移一并清理。
      if (!this.isWrongTypeError(error)) throw error;
    }
  }

  /** 解析旧格式的索引值（JSON 字符串数组）；无法解析时返回空数组。 */
  private async readLegacyUserIndex(indexKey: string): Promise<string[]> {
    let raw: string | null;
    try {
      raw = await this.redisService.get(indexKey);
    } catch {
      // 既不是 SET 也不是 string（如 hash/list）：无法迁移，放弃旧引用
      return [];
    }

    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      );
    } catch {
      return [];
    }
  }

  /**
   * 判断 Redis 是否因 key 实际类型与命令不匹配而拒绝执行。
   */
  private isWrongTypeError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('WRONGTYPE');
  }
}
