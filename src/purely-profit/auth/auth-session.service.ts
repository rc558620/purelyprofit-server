import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
import type { AccountIdentifiers } from './auth-account.types';
import { buildTokenVersionKey } from './auth.utils';

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
  ): Promise<AuthTokenResponseDto> {
    const payload: JwtPayload = {
      sub: userId,
      phone: identifiers.phone,
      accountScope: identifiers.accountScope,
      sessionVersion: await this.getTokenVersion(userId),
    };

    const refreshToken = await this.generateRefreshToken({
      userId,
      phone: identifiers.phone,
      email: identifiers.email,
      accountScope: identifiers.accountScope,
    });

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

    // 签发新的 token pair
    return this.signToken(stored.userId, {
      phone: stored.phone,
      email: stored.email,
      accountScope: stored.accountScope as AccountIdentifiers['accountScope'],
    });
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
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      case 'w': return value * 604800;
      case 'y': return value * 31536000;
      default: return value;
    }
  }
}
