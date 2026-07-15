import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
import type { AccountIdentifiers, SessionCategory } from './auth-account.types';
import { buildTokenVersionKey } from './auth.utils';
import {
  AUTH_SESSION_SET_KEY_PREFIX,
  AUTH_SESSION_SET_TTL_SECONDS,
  AUTH_SESSION_TOKEN_HASH_KEY_PREFIX,
  MAX_SESSIONS_CLUB,
  MAX_SESSIONS_PROFIT_MAIN,
  MAX_SESSIONS_PROFIT_SUB,
} from './auth.constants';

/**
 * Token version key 的 TTL（秒）。
 * 设置为 30 天，大于 JWT 最大有效期（默认 7 天），确保在 JWT 有效期内 version 始终可查。
 * 用户长期不活跃后 version 自然过期归零，避免 Redis 内存泄漏。
 */
const TOKEN_VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Refresh token 在 Redis 中的 key 前缀
 */
const REFRESH_TOKEN_KEY_PREFIX = 'auth:refresh-token:';

/**
 * Refresh token 默认有效期（秒）：30 天
 */
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

interface RefreshTokenPayload {
  userId: number;
  phone: string;
  email: string;
  accountScope?: string;
  staffId?: number;
  sid?: string;
}

@Injectable()
export class AuthSessionService {
  private readonly refreshTokenTtlSeconds: number;
  private readonly accessTokenTtlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.refreshTokenTtlSeconds =
      configService.get<number>('auth.refreshTokenTtlSeconds') ??
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS;

    // 解析 JWT expiresIn 为秒数，用于返回 expires_in 字段
    this.accessTokenTtlSeconds = this.parseExpiresInToSeconds(
      configService.get<string>('jwt.expiresIn') ?? '7d',
    );
  }

  async signToken(
    userId: number,
    identifiers: AccountIdentifiers,
    sid?: string,
  ): Promise<AuthTokenResponseDto> {
    const payload: JwtPayload = {
      sub: userId,
      phone: identifiers.phone,
      accountScope: identifiers.accountScope,
      sessionVersion: await this.getTokenVersion(userId),
      ...(identifiers.staffId != null ? { staffId: identifiers.staffId } : {}),
      ...(sid != null ? { sid } : {}),
    };

    const refreshToken = await this.generateRefreshToken(
      {
        userId,
        phone: identifiers.phone,
        email: identifiers.email,
        accountScope: identifiers.accountScope,
        ...(identifiers.staffId != null
          ? { staffId: identifiers.staffId }
          : {}),
        ...(sid != null ? { sid } : {}),
      },
      sid,
    );

    return {
      access_token: await this.jwtService.signAsync(payload),
      refresh_token: refreshToken,
      expires_in: this.accessTokenTtlSeconds,
      userId,
    };
  }

  /**
   * 使用 refresh token 签发新的 access_token + refresh_token（轮换）
   *
   * - 旧 refresh token 立即失效（一次性使用）
   * - 返回新的 access_token + refresh_token
   *
   * @returns 新的 token 响应，若 refresh token 无效则返回 null
   */
  async refreshAccessToken(
    rawRefreshToken: string,
  ): Promise<AuthTokenResponseDto | null> {
    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const key = `${REFRESH_TOKEN_KEY_PREFIX}${tokenHash}`;

    const stored = await this.redisService.getJson<RefreshTokenPayload>(key);
    if (!stored) return null;

    // 立即消费旧 token（rotation）
    await this.redisService.del(key);

    // 检查会话是否仍活跃（已被踢下线的会话不允许刷新）
    if (stored.sid) {
      const active = await this.isSessionActive(stored.userId, stored.sid);
      if (!active) return null;
    }

    // 签发新的 token pair（保留同一会话的 sid）
    return this.signToken(
      stored.userId,
      {
        phone: stored.phone,
        email: stored.email,
        accountScope: stored.accountScope as AccountIdentifiers['accountScope'],
        ...(stored.staffId != null ? { staffId: stored.staffId } : {}),
      },
      stored.sid,
    );
  }

  /**
   * 使指定用户的所有 refresh token 失效（密码变更/强制登出时调用）
   *
   * 通过 userId 索引 key 批量删除，避免全量 SCAN。
   */
  async invalidateAllRefreshTokens(userId: number): Promise<void> {
    const indexKey = `${REFRESH_TOKEN_KEY_PREFIX}user-index:${userId}`;
    const tokenHashes = await this.redisService.getJson<string[]>(indexKey);

    if (tokenHashes && tokenHashes.length > 0) {
      const keys = tokenHashes.map(
        (hash) => `${REFRESH_TOKEN_KEY_PREFIX}${hash}`,
      );
      await this.redisService.delMany(keys);
    }

    // 清除索引
    await this.redisService.del(indexKey);
  }

  // ── 会话生命周期管理 ─────────────────────────────────────

  private buildSessionKey(userId: number): string {
    return `${AUTH_SESSION_SET_KEY_PREFIX}${userId}`;
  }

  /**
   * 注册新会话并按账号类型执行并发会话淘汰：
   * - owner：无限制
   * - profit_main：最多 3 个，FIFO 淘汰最老的
   * - profit_sub / profit_club：只允许 1 个，踢掉所有旧的
   *
   * @returns 新会话的 sid
   */
  async registerSession(
    userId: number,
    category: SessionCategory,
  ): Promise<string> {
    const sid = randomBytes(16).toString('hex');
    const key = this.buildSessionKey(userId);
    const now = Date.now();

    const maxSessions = this.getMaxSessions(category);

    if (maxSessions !== Infinity) {
      const currentCount = await this.redisService.zcard(key);
      if (currentCount >= maxSessions) {
        const removeCount = currentCount - maxSessions + 1;
        // FIFO 淘汰最老的会话：先精确清理被淘汰会话的 refresh token
        await this.cleanupEvictedSessions(userId, key, removeCount);
      }
    }

    await this.redisService.zadd(key, now, sid, AUTH_SESSION_SET_TTL_SECONDS);
    return sid;
  }

  /**
   * 检查指定会话是否仍在活跃列表中
   */
  async isSessionActive(userId: number, sid: string): Promise<boolean> {
    const key = this.buildSessionKey(userId);
    const score = await this.redisService.zscore(key, sid);
    return score !== null;
  }

  /**
   * 移除用户的所有活跃会话（密码变更/重置时调用）
   */
  async removeAllSessions(userId: number): Promise<void> {
    await this.invalidateAllRefreshTokens(userId);
    await this.redisService.del(this.buildSessionKey(userId));
  }

  /**
   * 清理被淘汰会话的 refresh token 和 sid→tokenHash 映射。
   *
   * 流程：
   * 1. 从 sorted set 获取即将被淘汰的 sid 列表
   * 2. 通过 sid→tokenHash 映射找到对应的 refresh token hash
   * 3. 删除 refresh token、user-index 中的引用、sid 映射 key
   * 4. 从 sorted set 中移除被淘汰的 sid
   */
  private async cleanupEvictedSessions(
    userId: number,
    sessionKey: string,
    removeCount: number,
  ): Promise<void> {
    if (removeCount <= 0) return;

    // 1. 获取即将被淘汰的 sid 列表（sorted set 中 score 最小的 removeCount 个）
    const evictedSids = await this.redisService.zrange(
      sessionKey,
      0,
      removeCount - 1,
    );

    if (evictedSids.length === 0) return;

    // 2. 批量查找被淘汰 sid 对应的 refresh token hash
    const mappingKeys = evictedSids.map(
      (s: string) => `${AUTH_SESSION_TOKEN_HASH_KEY_PREFIX}${userId}:${s}`,
    );
    const tokenHashes = await this.redisService.mget(mappingKeys);

    // 3. 删除被淘汰会话的 refresh token 和 sid→tokenHash 映射 key
    const keysToDelete: string[] = [];
    for (const hash of tokenHashes) {
      if (hash) {
        keysToDelete.push(`${REFRESH_TOKEN_KEY_PREFIX}${hash}`);
      }
    }
    keysToDelete.push(...mappingKeys);

    if (keysToDelete.length > 0) {
      await this.redisService.delMany(keysToDelete);
    }

    // 4. 清理 user-index 中已失效的 hash 引用
    const validHashes = tokenHashes.filter((h): h is string => h !== null);
    await this.pruneUserIndex(userId, validHashes);

    // 5. 从 sorted set 中移除被淘汰的 sid
    await this.redisService.zremrangebyrank(sessionKey, 0, removeCount - 1);
  }

  /**
   * 从 user-index 中移除已失效的 token hash 引用，
   * 避免索引数组无限增长。
   */
  private async pruneUserIndex(
    userId: number,
    removedHashes: string[],
  ): Promise<void> {
    if (removedHashes.length === 0) return;

    const indexKey = `${REFRESH_TOKEN_KEY_PREFIX}user-index:${userId}`;
    const existing = await this.redisService.getJson<string[]>(indexKey);

    if (!existing || existing.length === 0) return;

    const removedSet = new Set(removedHashes);
    const pruned = existing.filter((h) => !removedSet.has(h));

    if (pruned.length === 0) {
      await this.redisService.del(indexKey);
    } else if (pruned.length < existing.length) {
      await this.redisService.setJson(
        indexKey,
        pruned,
        this.refreshTokenTtlSeconds,
      );
    }
  }

  private getMaxSessions(category: SessionCategory): number {
    switch (category) {
      case 'owner':
        return Infinity;
      case 'profit_main':
        return MAX_SESSIONS_PROFIT_MAIN;
      case 'profit_sub':
        return MAX_SESSIONS_PROFIT_SUB;
      case 'profit_club':
        return MAX_SESSIONS_CLUB;
      default:
        return MAX_SESSIONS_PROFIT_SUB;
    }
  }

  async bumpTokenVersion(userId: number): Promise<void> {
    const nextVersion = (await this.getTokenVersion(userId)) + 1;
    await this.redisService.set(
      buildTokenVersionKey(userId),
      String(nextVersion),
      TOKEN_VERSION_TTL_SECONDS,
    );
  }

  async getTokenVersion(userId: number): Promise<number> {
    const rawVersion = await this.redisService.get(
      buildTokenVersionKey(userId),
    );
    const parsedVersion = Number.parseInt(rawVersion ?? '0', 10);
    return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
  }

  private async generateRefreshToken(
    payload: RefreshTokenPayload,
    sid?: string,
  ): Promise<string> {
    const token = `rt_${randomBytes(32).toString('hex')}`;
    const tokenHash = this.hashRefreshToken(token);

    // 存储 token payload（key = hash，不存原文）
    const key = `${REFRESH_TOKEN_KEY_PREFIX}${tokenHash}`;
    await this.redisService.setJson(key, payload, this.refreshTokenTtlSeconds);

    // 维护 userId → tokenHash 索引（用于 invalidateAll）
    const indexKey = `${REFRESH_TOKEN_KEY_PREFIX}user-index:${payload.userId}`;
    const existing =
      (await this.redisService.getJson<string[]>(indexKey)) ?? [];
    existing.push(tokenHash);
    await this.redisService.setJson(
      indexKey,
      existing,
      this.refreshTokenTtlSeconds,
    );

    // 维护 sid → tokenHash 映射（用于会话淘汰时精确清理）
    if (sid) {
      const mappingKey = `${AUTH_SESSION_TOKEN_HASH_KEY_PREFIX}${payload.userId}:${sid}`;
      await this.redisService.set(
        mappingKey,
        tokenHash,
        this.refreshTokenTtlSeconds,
      );
    }

    return token;
  }

  /**
   * 对 refresh token 做 SHA-256 哈希，避免在 Redis 中存储明文
   */
  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiresInToSeconds(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhdwy]?)$/);
    if (!match) return 7 * 24 * 3600; // fallback 7 days

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      case 'w':
        return value * 604800;
      case 'y':
        return value * 31536000;
      default:
        return value;
    }
  }
}
