import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuthBanGuardService } from '../auth-ban-guard.service';
import { AuthMembershipResolverService } from '../auth-membership-resolver.service';
import { AuthSessionService } from '../auth-session.service';
import { AUTH_USER_CACHE_TTL_SECONDS } from '../auth.constants';
import type {
  AuthenticatedAccountScope,
  AuthPulseMode,
} from '../auth-account.types';
import { buildUserCacheKey, resolveAuthIdentity } from '../auth.utils';

export interface AuthenticatedUser {
  id: number;
  email: string;
  phone: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
  accountScope?: AuthenticatedAccountScope;
  currentMembership:
    | import('../../access-control/access-control.service').AuthenticatedMembership
    | null;
  pulseMode?: AuthPulseMode;
  isPulseDeveloper?: boolean;
}

export interface JwtPayload {
  sub: number;
  phone: string;
  accountScope?: AuthenticatedAccountScope;
  sessionVersion?: number;
  /** 登录时命中的 Staff ID，用于 membership 精确解析（旧 token 可能无此字段） */
  staffId?: number;
}

/**
 * JWT validate 链路中缓存的 user 最小字段集。
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

/**
 * resolveUser 返回的标准化 user 记录，Date 字段已从 Redis 反序列化回 Date 类型。
 */
interface ResolvedUserRecord {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly pulseDevAccountEmails: Set<string>;
  private readonly adminLoginPhone: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly authSessionService: AuthSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') ?? 'secret',
    });

    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
    this.adminLoginPhone =
      configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.resolveUser(payload.sub);

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const currentTokenVersion = await this.authSessionService.getTokenVersion(
      payload.sub,
    );
    if ((payload.sessionVersion ?? 0) < currentTokenVersion) {
      throw new UnauthorizedException('登录态已失效，请重新登录');
    }

    await this.authBanGuardService.ensureUserNotBanned(payload.sub);

    const identity = resolveAuthIdentity(
      user.email,
      payload.phone,
      this.pulseDevAccountEmails,
      this.adminLoginPhone,
    );
    const currentMembership =
      await this.authMembershipResolverService.resolveAuthenticatedMembership(
        payload,
        user.email,
      );

    // 异步更新 lastActiveAt，不阻塞鉴权流程
    // 使用 5 分钟节流避免每次请求都写库
    // 当触发更新时，返回值使用本次 now，确保下游拿到的 lastActiveAt 语义为"本次活跃时间"
    const now = new Date();
    const throttleMs = 5 * 60 * 1000;
    const shouldUpdateLastActiveAt =
      !user.lastActiveAt ||
      now.getTime() - user.lastActiveAt.getTime() > throttleMs;
    if (shouldUpdateLastActiveAt) {
      this.prisma.user
        .update({
          where: { id: user.id },
          data: { lastActiveAt: now },
        })
        .catch(() => {
          // 非关键路径，静默忽略更新失败
        });
    }

    return {
      id: user.id,
      email: user.email,
      phone: payload.phone,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastActiveAt: shouldUpdateLastActiveAt ? now : user.lastActiveAt,
      accountScope: payload.accountScope ?? identity.accountScope,
      currentMembership,
      pulseMode: identity.pulseMode,
      isPulseDeveloper: identity.isPulseDeveloper,
    };
  }

  /**
   * 从 Redis 缓存或数据库解析 user 基础信息。
   *
   * 缓存 TTL 为 5 分钟，用户资料变更时由 AuthAccountLookupService 主动失效。
   * 缓存仅包含鉴权所需的最小字段集，不包含密码、头像等敏感或非必要字段。
   */
  private async resolveUser(
    userId: number,
  ): Promise<ResolvedUserRecord | null> {
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

    // 异步回填缓存，不阻塞鉴权流程
    this.redisService
      .setJson(cacheKey, user, AUTH_USER_CACHE_TTL_SECONDS)
      .catch(() => {
        // 缓存写入失败不影响鉴权
      });

    return user;
  }
}
