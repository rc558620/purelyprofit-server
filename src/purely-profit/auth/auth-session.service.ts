import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../redis/redis.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
import type { AccountIdentifiers } from './auth-account.types';
import { buildTokenVersionKey } from './auth.utils';

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
    );
  }

  private async getTokenVersion(userId: number): Promise<number> {
    const rawVersion = await this.redisService.get(
      buildTokenVersionKey(userId),
    );
    const parsedVersion = Number.parseInt(rawVersion ?? '0', 10);
    return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
  }
}
