import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
  ) {}

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

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
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
}
